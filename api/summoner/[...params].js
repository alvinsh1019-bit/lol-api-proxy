export default async function handler(req, res) {
  // CORS 설정 - ChatGPT가 API를 호출할 수 있도록
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS 요청 처리 (CORS preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET 요청만 허용
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    // URL 파라미터 파싱: /api/summoner/gameName/tagLine
    const { params } = req.query;
    
    if (!params || params.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format. Expected: /api/summoner/{gameName}/{tagLine}',
        example: '/api/summoner/Hide%20on%20bush/KR1'
      });
    }

    const [rawGameName, rawTagLine] = params;
    
    // URL 디코딩 (한글 등 특수문자 처리)
    const gameName = decodeURIComponent(rawGameName);
    const tagLine = decodeURIComponent(rawTagLine);

    console.log(`🔍 Looking up summoner: ${gameName}#${tagLine}`);

    // 환경변수에서 API 키 가져오기
    const apiKey = process.env.RIOT_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error',
        message: 'API key not found'
      });
    }

    // 지역 설정 (기본값: asia)
    const region = req.query.region || 'asia';
    
    // 지역별 엔드포인트 매핑
    const regionEndpoints = {
      'americas': 'americas.api.riotgames.com',
      'asia': 'asia.api.riotgames.com', 
      'europe': 'europe.api.riotgames.com',
      'sea': 'sea.api.riotgames.com'
    };

    const endpoint = regionEndpoints[region];
    if (!endpoint) {
      return res.status(400).json({
        success: false,
        error: 'Invalid region',
        validRegions: Object.keys(regionEndpoints)
      });
    }

    // 1단계: Riot ID → PUUID 조회
    console.log(`📡 Step 1: Getting PUUID for ${gameName}#${tagLine}`);
    
    const accountUrl = `https://${endpoint}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    console.log(`🌐 Account API URL: ${accountUrl}`);

    const accountResponse = await fetch(accountUrl, {
      headers: {
        'X-Riot-Token': apiKey,
        'User-Agent': 'lol-api-proxy/1.0'
      }
    });

    console.log(`📊 Account API Response: ${accountResponse.status}`);

    if (!accountResponse.ok) {
      if (accountResponse.status === 404) {
        return res.status(404).json({
          success: false,
          error: 'Summoner not found',
          message: `No summoner found with Riot ID: ${gameName}#${tagLine}`,
          suggestions: [
            'Check the spelling of the game name',
            'Verify the tag line (e.g., KR1, NA1, EUW1)',
            'Make sure the account exists in the specified region'
          ]
        });
      }

      if (accountResponse.status === 403) {
        return res.status(403).json({
          success: false,
          error: 'API authentication failed',
          message: 'Invalid or expired API key'
        });
      }

      const errorText = await accountResponse.text();
      return res.status(accountResponse.status).json({
        success: false,
        error: 'Riot API error',
        status: accountResponse.status,
        details: errorText
      });
    }

    const accountData = await accountResponse.json();
    console.log(`✅ Account found - PUUID: ${accountData.puuid}`);

    // 2단계: PUUID → 소환사 정보 조회 (선택사항)
    const server = req.query.server || 'kr';
    
    // 서버별 엔드포인트 매핑
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

    let summonerData = null;
    const serverEndpoint = serverEndpoints[server];
    
    if (serverEndpoint) {
      console.log(`📡 Step 2: Getting summoner info from ${server}`);
      
      const summonerUrl = `https://${serverEndpoint}/lol/summoner/v4/summoners/by-puuid/${accountData.puuid}`;
      console.log(`🌐 Summoner API URL: ${summonerUrl}`);

      const summonerResponse = await fetch(summonerUrl, {
        headers: {
          'X-Riot-Token': apiKey,
          'User-Agent': 'lol-api-proxy/1.0'
        }
      });

      console.log(`📊 Summoner API Response: ${summonerResponse.status}`);

      if (summonerResponse.ok) {
        summonerData = await summonerResponse.json();
        console.log(`✅ Summoner info found - Level: ${summonerData.summonerLevel}`);
      } else {
        console.log(`⚠️ Summoner info not available on ${server}`);
      }
    }

    // 최종 응답 생성
    const response = {
      success: true,
      data: {
        // Account 정보 (필수)
        puuid: accountData.puuid,
        gameName: accountData.gameName,
        tagLine: accountData.tagLine,
        
        // Summoner 정보 (있는 경우만)
        ...(summonerData && {
          summonerId: summonerData.id,
          accountId: summonerData.accountId,
          summonerLevel: summonerData.summonerLevel,
          profileIconId: summonerData.profileIconId,
          revisionDate: summonerData.revisionDate
        })
      },
      metadata: {
        region: region,
        server: server,
        timestamp: new Date().toISOString()
      }
    };

    console.log(`🎉 Successfully retrieved data for ${gameName}#${tagLine}`);
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
