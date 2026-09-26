export interface SystemOneChoiceAnswer {
    type: 'choice';
    choice: string;
    confidence: number;
    probabilities?: Record<string, number>;
}

export interface SystemOneNoulAnswer {
    type: 'noul';
    probability: number;
}

export interface SystemOneScoreAnswer {
    type: 'score';
    score: number;
    confidence?: number;
}

export type SystemOneAnswer = SystemOneChoiceAnswer | SystemOneNoulAnswer | SystemOneScoreAnswer;

export interface SystemOneResponse {
    model?: string;
    answers: Record<string, SystemOneAnswer>;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
    };
}

export interface IntentDecisionResult {
    intent: 'send_message' | 'send_location' | 'check_balance' | 'bank_action' | 'conversation';
    recipientCategory: 'contact' | 'group' | 'none';
    confidence: number;
    probabilities?: Record<string, number>;
    source: 'laya' | 'fallback';
}

export interface LoanDecisionResult {
    recommendation: 'approved' | 'rejected';
    riskTier: 'low' | 'moderate' | 'high' | 'prohibitive';
    suggestedInterestRate: number; // e.g. 0.05
    suggestedTermDays: number; // e.g. 14 or 30
    confidence: number;
    source: 'laya' | 'fallback';
}

export interface CreditProfileSanitized {
    creditScore: number;
    reputation: 'Poor' | 'Fair' | 'Good' | 'Excellent';
    netWorthTier: 'low' | 'medium' | 'high' | 'ultra';
    requestedAmount: number;
    pastRepaymentsCount: number;
    pastDefaultsCount: number;
    hasCollateral: boolean;
}

export class DecisionService {
    private static readonly DEFAULT_ENDPOINT = 'https://laya.inference.zaitlabs.com/v1/systemone';
    private static readonly DEFAULT_MODEL = 'convaiinnovations/laya';
    private static readonly TIMEOUT_MS = 3000;
    private static readonly CIRCUIT_BREAKER_TTL_MS = 60_000; // 60s cooldown if down

    private static isCircuitOpen = false;
    private static circuitOpenUntil = 0;

    public static getEndpoint(): string {
        return process.env.LAYA_ENDPOINT || this.DEFAULT_ENDPOINT;
    }

    public static getModel(): string {
        return process.env.LAYA_MODEL || this.DEFAULT_MODEL;
    }

    /**
     * Checks if the circuit breaker is currently open (service in cooldown).
     */
    public static isAvailable(): boolean {
        if (this.isCircuitOpen) {
            if (Date.now() > this.circuitOpenUntil) {
                // Cooldown period expired, allow a trial request
                this.isCircuitOpen = false;
                return true;
            }
            return false;
        }
        return true;
    }

    private static recordFailure(): void {
        this.isCircuitOpen = true;
        this.circuitOpenUntil = Date.now() + this.CIRCUIT_BREAKER_TTL_MS;
        console.warn(
            `[DecisionService] Circuit breaker tripped. Laya upstream is cooling down for ${this.CIRCUIT_BREAKER_TTL_MS / 1000}s.`
        );
    }

    private static recordSuccess(): void {
        this.isCircuitOpen = false;
        this.circuitOpenUntil = 0;
    }

    /**
     * Executes raw query to System One endpoint with hard 3-second timeout and circuit breaker protection.
     */
    public static async querySystemOne(
        state: string | Record<string, unknown>,
        questions: Record<string, unknown>
    ): Promise<SystemOneResponse | null> {
        if (!this.isAvailable()) {
            return null;
        }

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };
            if (process.env.LAYA_API_KEY) {
                headers['Authorization'] = `Bearer ${process.env.LAYA_API_KEY}`;
            }

            const res = await fetch(this.getEndpoint(), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: this.getModel(),
                    state,
                    questions
                }),
                signal: controller.signal
            }).finally(() => clearTimeout(timer));

            if (!res.ok) {
                console.warn(`[DecisionService] Upstream returned status ${res.status}: ${res.statusText}`);
                this.recordFailure();
                return null;
            }

            const data = (await res.json()) as SystemOneResponse;
            this.recordSuccess();
            return data;
        } catch (err) {
            console.warn('[DecisionService] Call to Laya decision engine failed or timed out:', err);
            this.recordFailure();
            return null;
        }
    }

    /**
     * Classifies user intent and recipient type using Laya System One.
     */
    public static async classifyIntent(sanitizedState: string): Promise<IntentDecisionResult> {
        const questions = {
            intent: {
                type: 'choice',
                instructions:
                    'Classify the user primary intent: send_message (sending text/forward to a contact or group), send_location (sharing or forwarding geographical coordinates/location), check_balance (checking personal balance or wallet), bank_action (transfer, deposit, withdraw, loan), or conversation (general chatting, greeting, questions).',
                criteria: {
                    send_message: 'The user explicitly requests sending, forwarding, or delivering a text message.',
                    send_location: 'The user wants to share or forward their geographical location or coordinates.',
                    check_balance: 'The user asks for their account balance, wallet cash, or money status.',
                    bank_action:
                        'The user requests banking actions such as transferring, depositing, withdrawing, or loan operations.',
                    conversation: 'General conversation, chit-chat, greetings, bot status, or help questions.'
                }
            },
            recipient_category: {
                type: 'choice',
                instructions: 'Determine the target recipient mentioned in the prompt.',
                criteria: {
                    contact: 'A specific individual, contact token, person, alias, mom, friend, or user is targeted.',
                    group: 'A group chat, group token, team, club, or community is targeted.',
                    none: 'No external recipient is addressed or action is personal/local.'
                }
            }
        };

        const response = await this.querySystemOne(sanitizedState, questions);

        if (!response || !response.answers) {
            return this.fallbackIntentClassification(sanitizedState);
        }

        const intentAns = response.answers.intent as SystemOneChoiceAnswer | undefined;
        const recipientAns = response.answers.recipient_category as SystemOneChoiceAnswer | undefined;

        const rawIntent = intentAns?.choice || 'conversation';
        const validIntents = new Set<IntentDecisionResult['intent']>([
            'send_message',
            'send_location',
            'check_balance',
            'bank_action',
            'conversation'
        ]);
        const intent: IntentDecisionResult['intent'] = validIntents.has(rawIntent as IntentDecisionResult['intent'])
            ? (rawIntent as IntentDecisionResult['intent'])
            : 'conversation';

        const rawRecipient = recipientAns?.choice || 'none';
        const validRecipients = new Set<IntentDecisionResult['recipientCategory']>(['contact', 'group', 'none']);
        const recipientCategory: IntentDecisionResult['recipientCategory'] = validRecipients.has(
            rawRecipient as IntentDecisionResult['recipientCategory']
        )
            ? (rawRecipient as IntentDecisionResult['recipientCategory'])
            : 'none';

        const confidence = typeof intentAns?.confidence === 'number' ? intentAns.confidence : 0.8;

        return {
            intent,
            recipientCategory,
            confidence,
            probabilities: intentAns?.probabilities,
            source: 'laya'
        };
    }

    /**
     * Evaluates sanitized credit metrics into loan recommendation and risk tier.
     */
    public static async evaluateLoan(metrics: CreditProfileSanitized): Promise<LoanDecisionResult> {
        const state = {
            credit_score: metrics.creditScore,
            reputation: metrics.reputation,
            net_worth_tier: metrics.netWorthTier,
            requested_amount: metrics.requestedAmount,
            past_repayments: metrics.pastRepaymentsCount,
            past_defaults: metrics.pastDefaultsCount,
            has_collateral: metrics.hasCollateral
        };

        const questions = {
            recommendation: {
                type: 'choice',
                instructions:
                    'Determine whether the applicant is recommended for loan approval based strictly on credit score and past repayment record.',
                criteria: {
                    approved: 'Applicant demonstrates sufficient credit score (>=450) and acceptable default ratio.',
                    rejected:
                        'Applicant poses unacceptable default risk, sub-450 credit score, or excessive delinquency history.'
                }
            },
            risk_tier: {
                type: 'choice',
                instructions: 'Assign a credit risk tier to this application.',
                criteria: {
                    low: 'High credit score (>=750), high net worth, zero or minimal defaults.',
                    moderate: 'Good credit score (600-749), stable asset backing, manageable repayment history.',
                    high: 'Fair credit score (450-599), limited net worth, requires collateral or higher interest.',
                    prohibitive: 'Poor credit score (<450) or significant unresolved defaults.'
                }
            }
        };

        const response = await this.querySystemOne(state, questions);

        if (!response || !response.answers) {
            return this.fallbackLoanEvaluation(metrics);
        }

        const recAns = response.answers.recommendation as SystemOneChoiceAnswer | undefined;
        const tierAns = response.answers.risk_tier as SystemOneChoiceAnswer | undefined;

        const recommendation = recAns?.choice === 'approved' ? 'approved' : 'rejected';
        const rawTier = tierAns?.choice || 'high';
        const validTiers = new Set<LoanDecisionResult['riskTier']>(['low', 'moderate', 'high', 'prohibitive']);
        const riskTier: LoanDecisionResult['riskTier'] = validTiers.has(rawTier as LoanDecisionResult['riskTier'])
            ? (rawTier as LoanDecisionResult['riskTier'])
            : 'high';
        // Map risk tier to suggested terms (bounded strictly by code rules)
        let suggestedInterestRate = 0.06;
        let suggestedTermDays = 21;

        if (riskTier === 'low') {
            suggestedInterestRate = 0.03;
            suggestedTermDays = 30;
        } else if (riskTier === 'moderate') {
            suggestedInterestRate = 0.06;
            suggestedTermDays = 21;
        } else if (riskTier === 'high') {
            suggestedInterestRate = 0.1;
            suggestedTermDays = 14;
        } else {
            suggestedInterestRate = 0.15;
            suggestedTermDays = 7;
        }

        const confidence = typeof recAns?.confidence === 'number' ? recAns.confidence : 0.85;

        return {
            recommendation,
            riskTier,
            suggestedInterestRate,
            suggestedTermDays,
            confidence,
            source: 'laya'
        };
    }

    /**
     * Fallback intent classification if Laya upstream is unavailable.
     */
    private static fallbackIntentClassification(sanitizedState: string): IntentDecisionResult {
        const text = sanitizedState.toLowerCase();
        let intent: IntentDecisionResult['intent'] = 'conversation';
        let recipientCategory: IntentDecisionResult['recipientCategory'] = 'none';

        if (/saldo|balance|uang|duit|rekening\b/i.test(text)) {
            intent = 'check_balance';
        } else if (/transfer|deposit|withdraw|tarik|setor|pinjam|loan\b/i.test(text)) {
            intent = 'bank_action';
        } else if (/lokasi|location|shareloc|maps|koordinat/i.test(text)) {
            intent = 'send_location';
        } else if (/kirim|forward|teruskan|send|chat|message\b/i.test(text)) {
            intent = 'send_message';
        }

        if (/contact_ref_|recipient|user|contact/i.test(text)) {
            recipientCategory = 'contact';
        } else if (/group_ref_|group|grup|komunitas/i.test(text)) {
            recipientCategory = 'group';
        }

        return {
            intent,
            recipientCategory,
            confidence: 0.6,
            source: 'fallback'
        };
    }

    /**
     * Fallback deterministic loan evaluation.
     */
    private static fallbackLoanEvaluation(metrics: CreditProfileSanitized): LoanDecisionResult {
        if (metrics.creditScore < 450 || metrics.pastDefaultsCount > metrics.pastRepaymentsCount) {
            return {
                recommendation: 'rejected',
                riskTier: 'prohibitive',
                suggestedInterestRate: 0.15,
                suggestedTermDays: 7,
                confidence: 0.9,
                source: 'fallback'
            };
        }

        if (metrics.creditScore >= 750) {
            return {
                recommendation: 'approved',
                riskTier: 'low',
                suggestedInterestRate: 0.04,
                suggestedTermDays: 30,
                confidence: 0.85,
                source: 'fallback'
            };
        }

        if (metrics.creditScore >= 600) {
            return {
                recommendation: 'approved',
                riskTier: 'moderate',
                suggestedInterestRate: 0.06,
                suggestedTermDays: 21,
                confidence: 0.8,
                source: 'fallback'
            };
        }

        return {
            recommendation: 'approved',
            riskTier: 'high',
            suggestedInterestRate: 0.09,
            suggestedTermDays: 14,
            confidence: 0.75,
            source: 'fallback'
        };
    }
}
