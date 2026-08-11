export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY가 서버 환경 변수에 설정되어 있지 않습니다.' });
    }

    try {
        const { participant } = req.body || {};
        if (!participant) {
            return res.status(400).json({ error: '참여자 정보가 누락되었습니다.' });
        }

        const isExperienced = participant.experienceType === 'experienced';
        const isDecided = participant.careerDecision === 'decided';
        const careerDecisionLabel = participant.careerDecision === 'decided' ? '진로결정' : '미결정관련 탐색';
        const careerGuidance = isDecided
            ? '참여자는 진로를 이미 결정한 상태입니다. 목표 달성, 전환 계획, 역량 갭, 실행 계획 중심의 질문을 작성하세요.'
            : '참여자는 진로가 미결정 상태입니다. 자기탐색, 가치관, 적성, 관심 분야 비교, 선택지 확장 중심의 질문을 작성하세요. 희망 직무는 탐색 방향으로 해석하세요.';

        const stage1Title = isDecided
            ? (isExperienced ? '경력탐색' : '관심탐색')
            : '진로탐색';
        const stage1Description = isDecided
            ? (isExperienced ? '구체적 업무 경험과 성과 관련 질문' : '관심 분야와 적성 관련 질문')
            : '적성, 가치관, 관심 분야 탐색 관련 질문';
        const stage3Title = isDecided ? '미래 목표' : '선택지 확장';
        const stage3Description = isDecided
            ? '희망 직무 및 목표 관련 질문'
            : '가능한 진로 옵션 비교 및 우선순위 관련 질문';

        const prompt = `당신은 전문 직업상담사입니다. 아래 참여자 정보를 분석하여 구체적이고 실용적인 4단계 맞춤형 직업상담 질문지를 작성해주세요.

참여자 정보:
- 나이: ${participant.age}세
- 성별: ${participant.gender}
- 경력 유형: ${isExperienced ? '경력자' : '신입/무경력'}
- 산업 분야: ${participant.industry || '미지정'}
- 직무 유형: ${participant.jobType || '미지정'}
- 경력 기간: ${participant.experience > 0 ? participant.experience + '년' : '없음'}
- 진로결정 여부: ${careerDecisionLabel}
- 희망 직무/목표: ${participant.goal}
- 현재 상황: ${participant.situation}

맞춤 지침:
${careerGuidance}

다음 JSON 구조에 맞춰 응답해 주세요:
{
  "stage1": {
    "title": "1단계: ${stage1Title}",
    "description": "${stage1Description}",
    "count": 5,
    "questions": ["질문1", "질문2", "질문3", "질문4", "질문5"]
  },
  "stage2": {
    "title": "2단계: 현재 상황",
    "description": "진로 준비 상황 및 어려움 관련 질문",
    "count": 3,
    "questions": ["질문1", "질문2", "질문3"]
  },
  "stage3": {
    "title": "3단계: ${stage3Title}",
    "description": "${stage3Description}",
    "count": 4,
    "questions": ["질문1", "질문2", "질문3", "질문4"]
  },
  "stage4": {
    "title": "4단계: 제약조건",
    "description": "근무지, 급여, 근무 형태 관련 질문",
    "count": 3,
    "questions": ["질문1", "질문2", "질문3"]
  }
}`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('Gemini API Error:', errText);
            return res.status(response.status).json({ error: `Gemini API 호출 실패 (상태: ${response.status})` });
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
            return res.status(500).json({ error: 'Gemini API 응답에서 텍스트를 찾을 수 없습니다.' });
        }

        const questionsJson = JSON.parse(rawText);
        return res.status(200).json({ success: true, questions: questionsJson });
    } catch (error) {
        console.error('Server error:', error);
        return res.status(500).json({ error: error.message || '서버 내부 오류가 발생했습니다.' });
    }
}
