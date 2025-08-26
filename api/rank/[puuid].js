export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    const { puuid } = req.query;
    
    if (!puuid) {
      return res.status(400).json({
        success: false,
        error: 'PUUID is required',
        example: '/api/rank/{puuid}?server=kr'
      });
    }

    console.log(`🏆 Looking up rank for PUUID: ${puuid}`);

    const apiKey = process.env.RIOT_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'API key not configured'
      });
    }

    const server = req.query.server || 'kr';
    
    // 서버별 엔드포인트
    const serverEndpoints = {
      'kr': 'kr.api.riotgames.com',
      'jp1': 'jp1.api.riotgames.com',
      'na1': 'na1.api.riotgames.com',
      'br1': 'br1.api.riotgames.com',
      'lan': 'lan.api.riotgames.com',
      'las': 'las.api.riotgames.com',
      'oc1': 'oc1.api.riotgames.com',
      'euw1': 'euw1.api.riotgames.com',
      'eun1': 'eun1.api.riotgames.com',
      'tr1': 'tr1.api.riotgames.com',
      'ru': 'ru.api.riotgames.com'
    };

    const endpoint = serverEndpoints[server];
    if (!endpoint) {
      return res.status(400).json({
        success: false,
        error: 'Invalid server',
        validServers: Object.keys(serverEndpoints)
      });
    }

    // 1단계: PUUID로 소환사 ID 조회
    console.log(`📡 Step 1: Getting summoner ID from PUUID`);
    
    const summonerUrl = `https://${endpoint}/lol/summoner/v4/summoners/by-puuid/${puuid}`;
    const summonerResponse = await fetch(summonerUrl, {
      headers: {
        'X-Riot-Token': apiKey,
        'User-Agent': 'lol-api-proxy/1.0'
      }
    });

    if (!summonerResponse.ok) {
      if (summonerResponse.status === 404) {
        return res.status(404).json({
          success: false,
          error: 'Summoner not found on this server',
          message: `No summoner found with PUUID on ${server} server`
        });
      }
      
      return res.status(summonerResponse.status).json({
        success: false,
        error: 'Failed to get summoner info',
        status: summonerResponse.status
      });
    }

    const summonerData = await summonerResponse.json();
    console.log(`✅ Found summoner - ID: ${summonerData.id}`);

    // 2단계: 소환사 ID로 랭크 정보 조회
    console.log(`📡 Step 2: Getting rank info for summoner ID`);
    
    const rankUrl = `https://${endpoint}/lol/league/v4/entries/by-summoner/${summonerData.id}`;
    const rankResponse = await fetch(rankUrl, {
      headers: {
        'X-Riot-Token': apiKey,
        'User-Agent': 'lol-api-proxy/1.0'
      }
    });

    if (!rankResponse.ok) {
      return res.status(rankResponse.status).json({
        success: false,
        error: 'Failed to get rank info',
        status: rankResponse.status
      });
    }

    const rankData = await rankResponse.json();
    console.log(`✅ Found ${rankData.length} ranked entries`);

    // 랭크 데이터 처리
    const processedRanks = rankData.map(entry => ({
      queueType: entry.queueType,
      tier: entry.tier,
      rank: entry.rank,
      leaguePoints: entry.leaguePoints,
      wins: entry.wins,
      losses: entry.losses,
      winRate: Math.round((entry.wins / (entry.wins + entry.losses)) * 100 * 100) / 100,
      veteran: entry.veteran || false,
      inactive: entry.inactive || false,
      freshBlood: entry.freshBlood || false,
      hotStreak: entry.hotStreak || false,
      leagueName: entry.leagueName || null,
      miniSeries: entry.miniSeries || null
    }));

    const response = {
      success: true,
      data: {
        puuid: puuid,
        summonerId: summonerData.id,
        summonerLevel: summonerData.summonerLevel,
        ranks: processedRanks,
        summary: {
          totalRankedQueues: processedRanks.length,
          highestTier: processedRanks.length > 0 ? 
            processedRanks.reduce((highest, current) => 
              getTierValue(current.tier) > getTierValue(highest.tier) ? current : highest
            ).tier : null
        }
      },
      metadata: {
        server: server,
        timestamp: new Date().toISOString()
      }
    };

    console.log(`🎉 Successfully retrieved rank data`);
    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Handler error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}

// 티어 값 계산 (높은 티어일수록 큰 값)
function getTierValue(tier) {
  const tierValues = {
    'IRON': 1,
    'BRONZE': 2, 
    'SILVER': 3,
    'GOLD': 4,
    'PLATINUM': 5,
    'EMERALD': 6,
    'DIAMOND': 7,
    'MASTER': 8,
    'GRANDMASTER': 9,
    'CHALLENGER': 10
  };
  return tierValues[tier] || 0;
}
