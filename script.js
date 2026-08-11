document.getElementById('experienceType').addEventListener('change', function() {
    const isExperienced = this.value === 'experienced';
    document.getElementById('industryGroup').style.display = isExperienced ? 'block' : 'none';
    document.getElementById('jobTypeGroup').style.display = isExperienced ? 'block' : 'none';
    document.getElementById('experienceGroup').style.display = isExperienced ? 'block' : 'none';
});

document.getElementById('careerDecision').addEventListener('change', function() {
    const goalInput = document.getElementById('goal');
    if (this.value === 'undecided') {
        goalInput.placeholder = '예: 사무직, 서비스업 등 관심 분야 (탐색 중)';
    } else {
        goalInput.placeholder = '예: 사무직 전환';
    }
});

function getCareerDecisionLabel(value) {
    return value === 'decided' ? '진로결정' : '미결정관련 탐색';
}

// 초기화: 경력 유형 미선택 시 경력 관련 필드 숨기기
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('industryGroup').style.display = 'none';
    document.getElementById('jobTypeGroup').style.display = 'none';
    document.getElementById('experienceGroup').style.display = 'none';
});

// Vercel Serverless API (/api/generate)를 통해 백엔드에서 안전하게 Gemini 질문 생성
async function generateQuestionsWithServer(participant) {
    const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ participant })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API 호출 실패 (상태 코드: ${response.status})`);
    }

    const data = await response.json();
    if (!data.success || !data.questions) {
        throw new Error('API 응답에서 유효한 질문 데이터를 받지 못했습니다.');
    }

    return data.questions;
}

document.getElementById('participantForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const submitBtn = this.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '✨ Gemini AI 질문 생성 중...';

    const experienceType = document.getElementById('experienceType').value;
    const isExperienced = experienceType === 'experienced';
    
    const participant = {
        age: parseInt(document.getElementById('age').value),
        gender: document.getElementById('gender').value === 'male' ? '남성' : '여성',
        experienceType: experienceType,
        industry: isExperienced ? document.getElementById('industry').value : '',
        jobType: isExperienced ? document.getElementById('jobType').value : '',
        experience: isExperienced ? parseInt(document.getElementById('experience').value) : 0,
        careerDecision: document.getElementById('careerDecision').value,
        goal: document.getElementById('goal').value,
        situation: document.getElementById('situation').value || '현재 상황 미기재'
    };
    
    let questions;
    let isAiGenerated = false;

    try {
        questions = await generateQuestionsWithServer(participant);
        isAiGenerated = true;
    } catch (error) {
        console.warn('Gemini API 서버 호출 실패 (기본 템플릿으로 대체):', error.message);
        questions = generateQuestions(participant);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
    }

    displayResults(participant, questions, isAiGenerated);
});

function generateQuestions(p) {
    const isExperienced = p.experienceType === 'experienced';
    const isDecided = p.careerDecision === 'decided';
    const yearsText = p.experience > 0 ? p.experience + '년' : '';

    const stage4 = {
        title: '4단계: 제약조건',
        description: '지역, 급여, 근무시간 등 관련된 질문',
        count: 3,
        questions: isExperienced
            ? [
                `희망하시는 근무 지역이나 출퇴근 가능 범위가 있으신가요?`,
                `기대하시는 월 급여 수준이나 생활비 고려 사항이 있으시다면 말씀해 주세요.`,
                `원하시는 근무시간 형태가 있으신가요? 예: 정규직, 계약직, 시간제, 유연근무 등`
            ]
            : [
                `희망하시는 근무 지역이나 출퇴근 가능 범위가 있으신가요?`,
                `첫 직장에 대한 급여 기대치가 있으시다면 말씀해 주세요. 또는 본인의 생활비 상황은 어떤가요?`,
                `원하시는 근무 형태가 있으신가요? 예: 정규직, 인턴, 계약직, 시간제 등`
            ]
    };

    if (isExperienced && isDecided) {
        return {
            stage1: {
                title: '1단계: 경력탐색',
                description: '구체적 업무 경험과 성과 관련된 질문',
                count: 5,
                questions: [
                    `${p.industry} ${p.jobType}으로 ${yearsText} 동안 근무하셨다고 하셨는데, 가장 기억에 남는 업무 성과가 있으신가요?`,
                    `${p.industry} 현장에서 가장 자신 있었던 업무나 역할은 무엇이었나요?`,
                    `수년간의 근무 기간 중 가장 힘들었던 업무적 도전과 그것을 어떻게 극복하셨는지 말씀해 주세요.`,
                    `동료들이나 상사로부터 칭찬을 받았던 경험이 있으시다면 어떤 일이었나요?`,
                    `${p.jobType}으로서 쌓으신 전문성이나 특별한 기술, 노하우가 있다면 소개해 주세요.`
                ]
            },
            stage2: {
                title: '2단계: 현재 상황',
                description: '퇴직 배경과 재취업 의지 관련된 질문',
                count: 3,
                questions: [
                    `${p.situation}으로 새로운 시작을 준비하고 계시다고 들었습니다. 어떤 계기로 ${p.goal}을 생각하게 되셨나요?`,
                    `현재 재취업이나 전환을 준비하면서 가장 크게 느끼시는 어려움이나 걱정이 있으신가요?`,
                    `가족이나 주변 분들의 의견은 어떤가요? 새로운 도전에 대한 주변의 반응이 궁금합니다.`
                ]
            },
            stage3: {
                title: '3단계: 미래 목표',
                description: '결정된 진로 목표의 구체화 및 실행 계획 관련 질문',
                count: 4,
                questions: [
                    `${p.goal}을 선택하신 가장 큰 이유는 무엇인가요?`,
                    `이상적인 ${p.goal}의 모습은 어떤 것인가요? 하루 일과가 어떻게 보내시길 바라시나요?`,
                    `목표 직무에 필요한 역량 중 본인이 갖춘 것과 부족한 것은 무엇이라고 생각하시나요?`,
                    `목표를 달성하기 위해 6개월~1년 내에 꼭 이루고 싶은 것은 무엇인가요?`
                ]
            },
            stage4
        };
    }

    if (isExperienced && !isDecided) {
        return {
            stage1: {
                title: '1단계: 진로탐색',
                description: '경력 기반 적성과 관심 분야 탐색 관련 질문',
                count: 5,
                questions: [
                    `아직 진로가 정해지지 않으셨다고 하셨는데, ${yearsText}간 ${p.industry} ${p.jobType} 경험 중 가장 보람 있었던 업무는 무엇이었나요?`,
                    `일할 때 가장 중요하게 생각하시는 가치 3가지는 무엇인가요? (예: 안정, 성장, 워라밸 등)`,
                    `"${p.goal}"은 탐색 중인 방향 중 하나인가요? 그 방향에 관심을 갖게 된 계기는 무엇인가요?`,
                    `경력을 살려 갈 수 있는 분야와 새롭게 시작할 수 있는 분야 중 어떤 쪽에 더 관심이 있으신가요?`,
                    `진로 결정을 막고 있다고 느끼는 요인(정보 부족, 자신감, 주변 의견 등)이 있으신가요?`
                ]
            },
            stage2: {
                title: '2단계: 현재 상황',
                description: '진로 탐색 상황과 어려움 관련 질문',
                count: 3,
                questions: [
                    `${p.situation}으로 새로운 시작을 준비하고 계시다고 들었습니다. 현재 진로 탐색을 시작하게 된 계기는 무엇인가요?`,
                    `진로를 결정하지 못한 상태에서 가장 크게 느끼시는 어려움이나 불안은 무엇인가요?`,
                    `진로 탐색 과정에서 도움을 받고 싶은 부분이 있다면 무엇인가요?`
                ]
            },
            stage3: {
                title: '3단계: 선택지 확장',
                description: '가능한 진로 옵션 비교 및 우선순위 관련 질문',
                count: 4,
                questions: [
                    `현재 고려 중인 직무·진로 옵션을 2~3가지 말씀해 주실 수 있을까요?`,
                    `각 옵션의 장단점을 본인 기준으로 비교해 보신 적이 있으신가요?`,
                    `기존 ${p.jobType} 경력을 활용할 수 있는 새로운 분야에 대해 알아보신 적이 있으신가요?`,
                    `상담을 통해 가장 먼저 확인하고 싶은 것은 무엇인가요?`
                ]
            },
            stage4
        };
    }

    if (!isExperienced && isDecided) {
        return {
            stage1: {
                title: '1단계: 관심탐색',
                description: '관심 분야와 적성 관련된 질문',
                count: 5,
                questions: [
                    `${p.goal}에 관심을 갖게 된 구체적인 계기가 있으신가요?`,
                    `평소에 어떤 활동을 하실 때 시간이 가는 줄 모르고 몰입하시는 편인가요?`,
                    `학교나 주변에서 받은 피드백 중 "이 일이 잘 어울린다"는 이야기를 들어본 적이 있으신가요?`,
                    `자신이 잘하는 것 또는 좋아하는 것이 3가지라면 어떤 것들이 있을까요?`,
                    `반대로 힘들어하는 일이거나 피하고 싶은 유형의 업무가 있으신가요?`
                ]
            },
            stage2: {
                title: '2단계: 현재 상황',
                description: '진로 준비 상황과 의지 관련된 질문',
                count: 3,
                questions: [
                    `${p.situation}으로 새로운 시작을 준비하고 계시다고 들었습니다. 어떤 계기로 ${p.goal}을 생각하게 되셨나요?`,
                    `현재 진로나 취업을 준비하면서 가장 크게 느끼시는 어려움이나 걱정이 있으신가요?`,
                    `주변의 지지 체계는 어떤가요? 가족이나 친구, 멘토의 도움을 받고 계신가요?`
                ]
            },
            stage3: {
                title: '3단계: 미래 목표',
                description: '결정된 진로 목표의 구체화 및 실행 계획 관련 질문',
                count: 4,
                questions: [
                    `${p.goal}을 선택하신 가장 큰 이유는 무엇인가요?`,
                    `이상적인 ${p.goal}의 모습은 어떤 것인가요? 하루 일과가 어떻게 보내시길 바라시나요?`,
                    `목표 직무에 필요한 역량 중 본인이 갖춘 것과 부족한 것은 무엇이라고 생각하시나요?`,
                    `${p.goal}을 달성하기 위해 현재 준비하고 계신 것이나 하고 싶은 학습이 있으신가요?`
                ]
            },
            stage4
        };
    }

    return {
        stage1: {
            title: '1단계: 진로탐색',
            description: '적성, 가치관, 관심 분야 탐색 관련 질문',
            count: 5,
            questions: [
                `아직 진로가 정해지지 않으셨다고 하셨는데, 평소 시간 가는 줄 모르고 하는 활동이 있으신가요?`,
                `일할 때 가장 중요하게 생각하시는 가치 3가지는 무엇인가요? (예: 안정, 성장, 워라밸 등)`,
                `"${p.goal}"은 탐색 중인 방향 중 하나인가요? 그 방향에 관심을 갖게 된 계기는 무엇인가요?`,
                `관심 있는 분야나 직무가 여러 개라면, 각각 어떤 점이 끌리시나요?`,
                `진로 결정을 막고 있다고 느끼는 요인(정보 부족, 자신감, 주변 의견 등)이 있으신가요?`
            ]
        },
        stage2: {
            title: '2단계: 현재 상황',
            description: '진로 탐색 상황과 어려움 관련 질문',
            count: 3,
            questions: [
                `${p.situation}으로 새로운 시작을 준비하고 계시다고 들었습니다. 현재 진로 탐색을 시작하게 된 계기는 무엇인가요?`,
                `진로를 결정하지 못한 상태에서 가장 크게 느끼시는 어려움이나 불안은 무엇인가요?`,
                `주변의 지지 체계는 어떤가요? 가족이나 친구, 멘토의 도움을 받고 계신가요?`
            ]
        },
        stage3: {
            title: '3단계: 선택지 확장',
            description: '가능한 진로 옵션 비교 및 우선순위 관련 질문',
            count: 4,
            questions: [
                `현재 고려 중인 직무·진로 옵션을 2~3가지 말씀해 주실 수 있을까요?`,
                `각 옵션의 장단점을 본인 기준으로 비교해 보신 적이 있으신가요?`,
                `진로를 결정하기 위해 더 알아보고 싶은 정보가 있다면 무엇인가요?`,
                `상담을 통해 가장 먼저 확인하고 싶은 것은 무엇인가요?`
            ]
        },
        stage4
    };
}

function displayResults(participant, questions, isAiGenerated = false) {
    document.getElementById('outputSection').style.display = 'block';
    
    const badgeHTML = isAiGenerated 
        ? '<span class="ai-badge">✨ Gemini AI 생성</span>'
        : '<span class="template-badge">📋 기본 템플릿</span>';

    const isExperienced = participant.experienceType === 'experienced';
    const experienceInfo = isExperienced 
        ? `<p><strong>경력:</strong> ${participant.industry} ${participant.jobType} ${participant.experience}년</p>`
        : '<p><strong>경력:</strong> 신입/무경력</p>';
    
    document.getElementById('participantSummary').innerHTML = `
        <div class="summary-header">
            <h3>참여자 정보</h3>
            ${badgeHTML}
        </div>
        <p><strong>기본정보:</strong> ${participant.age}세, ${participant.gender}</p>
        ${experienceInfo}
        <p><strong>진로 상태:</strong> ${getCareerDecisionLabel(participant.careerDecision)}</p>
        <p><strong>현재 상황:</strong> ${participant.situation}</p>
        <p><strong>희망 목표:</strong> ${participant.goal}</p>
    `;
    
    let questionsHTML = '';
    
    for (const [key, stage] of Object.entries(questions)) {
        if (!stage) continue;
        const count = stage.questions ? stage.questions.length : (stage.count || 0);
        questionsHTML += `
            <div class="stage">
                <div class="stage-header">
                    <h3>${stage.title || ''}</h3>
                    <span class="count">${count}개 질문</span>
                </div>
                <div class="stage-content">
                    ${(stage.questions || []).map((q, i) => `
                        <div class="question-item">
                            <span class="question-number">${i + 1}</span>
                            <span class="question-text">${q}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    document.getElementById('questionsContainer').innerHTML = questionsHTML;
    
    document.getElementById('outputSection').scrollIntoView({ behavior: 'smooth' });
}

function resetForm() {
    document.getElementById('participantForm').reset();
    document.getElementById('outputSection').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}