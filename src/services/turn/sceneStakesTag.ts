import type { SceneStakes, EndpointConfig, ProviderConfig } from '../../types';
import { llmCall } from '../../utils/llmCall';
import { recordSceneStakesFallback } from './sceneStakesTelemetry';
import { ENGINE_CALL_TIMEOUT_MS } from '../llm/timeouts';

// Phase 2 port: mobile used a shared infrastructure/utilityPrompts module for these constant
// sections; desktop has no equivalent shared module. Inlined here (small + only used by this
// helper) — a future refactor can lift them to a shared utilityPrompts module if more callers
// need them.
const TTRPG_PERSONA_STATE_ANALYZER = 'You are a background game state analyzer.';
const JSON_ONLY_FOOTER = 'Respond with ONE JSON object only. No prose, no markdown fences.';
const ANCHOR_BEFORE_INPUT = 'Now produce the JSON described above for the INPUT below.';
const INPUT_DELIMITER = '----- INPUT -----';

function joinPromptSections(...sections: Array<string | null | undefined>): string {
    return sections.filter(Boolean).join('\n\n');
}

const SCENE_STAKES_RE = /\[\[SCENE_STAKES:\s*(calm|tense|dangerous)\s*\]\]/i;
// The strip pattern is deliberately laxer than the match pattern, and global.
//
// `[^\]]*` rather than `\s*\S+\s*`: a multi-word value ("very tense", "tense — the guard
// noticed") matched NEITHER regex before, so the tag survived into the player's prose. And
// `/g` because one stray second copy would likewise have survived. Both only started to
// matter once the prompt actually began asking for the tag (see stable.ts) — until then the
// writer emitted it rarely enough that neither case was reachable.
//
// Kept separate from SCENE_STAKES_RE, which must stay non-global: `String.match` with /g
// returns all matches and NO capture groups, so `match[1]` below would break.
const SCENE_STAKES_STRIP_RE = /\[\[SCENE_STAKES:[^\]]*\]\]/gi;
const VALID_STAKES: Set<string> = new Set(['calm', 'tense', 'dangerous']);

// Only ever used via String.prototype.match/replace, which reset a global regex's lastIndex —
// never RegExp.test/exec, which would carry it between calls.
const stripTags = (text: string): string =>
    text.replace(SCENE_STAKES_STRIP_RE, '').replace(/ +$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

export function extractAndStripSceneStakes(text: string): { displayText: string; stakes: SceneStakes } {
    const match = text.match(SCENE_STAKES_RE);
    if (!match) {
        const garbled = text.match(SCENE_STAKES_STRIP_RE);
        if (garbled) {
            return { displayText: stripTags(text), stakes: 'calm' };
        }
        return { displayText: text, stakes: 'calm' };
    }
    const raw = match[1].toLowerCase();
    const stakes: SceneStakes = VALID_STAKES.has(raw) ? (raw as SceneStakes) : 'calm';
    return { displayText: stripTags(text), stakes };
}

export async function classifySceneStakes(
    provider: EndpointConfig | ProviderConfig | undefined,
    recentScene: string,
    modelCall?: (prompt: string, options: {
        priority: 'low';
        maxTokens: number;
        thinkingEffort: 'off';
        trackingLabel: string;
        timeoutMs: number;
    }) => Promise<string>,
): Promise<SceneStakes> {
    const prompt = joinPromptSections(
        TTRPG_PERSONA_STATE_ANALYZER,
        'TASK: Classify the scene stakes as one of: calm, tense, dangerous.\n' +
        'calm = no immediate threat; tense = physical OR social/political threat looming;\n' +
        'dangerous = active harm or imminent deadly/ruinous consequences.',
        JSON_ONLY_FOOTER,
        'Output ONLY: {"stakes":"calm"} or {"stakes":"tense"} or {"stakes":"dangerous"}',
        ANCHOR_BEFORE_INPUT,
        INPUT_DELIMITER,
        recentScene.slice(0, 3000),
    );

    recordSceneStakesFallback();

    try {
        const raw = modelCall
            ? await modelCall(prompt, { priority: 'low', maxTokens: 20, thinkingEffort: 'off', trackingLabel: 'scene-stakes-classify', timeoutMs: ENGINE_CALL_TIMEOUT_MS })
            : provider
                ? await llmCall(provider, prompt, {
                    priority: 'low',
                    maxTokens: 20,
                    thinkingEffort: 'off',
                    trackingLabel: 'scene-stakes-classify',
                    timeoutMs: ENGINE_CALL_TIMEOUT_MS,
                })
                : null;
        if (raw === null) return 'calm';
        const cleaned = raw.replace(/<think[\s\S]*?<\/think>/gi, '').trim();
        const parsed = JSON.parse(cleaned);
        const s = String(parsed.stakes ?? '').toLowerCase();
        if (VALID_STAKES.has(s)) return s as SceneStakes;
    } catch { /* malformed → calm */ }
    return 'calm';
}