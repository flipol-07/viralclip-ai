/**
 * ASS subtitle generation for ONE render unit, parametrized by caption style.
 * Word times are remapped to unit-local time. Split layout pins captions to
 * the seam between the two halves; other layouts use the lower-middle third.
 */
import fs from 'fs';
import { captionEmojisEnabled, type CaptionStyle } from './styles';
import type { TranscriptWord } from '@/shared/types';

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function generateUnitSubtitles(options: {
    words: TranscriptWord[];
    keywords: string[];
    srcStart: number;
    srcEnd: number;
    layout: string;
    hookTitle?: string;
    emoji?: string;
    style: CaptionStyle;
    subsPath: string;
}): string | undefined {
    const { words, keywords, srcStart, srcEnd, layout, hookTitle, emoji, style, subsPath } = options;
    const unitDur = srcEnd - srcStart;

    const clipWords = words
        .filter(w => w.start >= srcStart - 0.2 && w.end <= srcEnd + 0.2)
        .map(w => ({
            word: w.word,
            start: Math.max(0, w.start - srcStart),
            end: Math.min(unitDur, w.end - srcStart),
            isKeyword: keywords.some(k => norm(w.word) === norm(k)),
        }))
        .filter(w => w.end > w.start);

    if (clipWords.length === 0 && !hookTitle) return undefined;

    // Split layout: captions live on the seam (Alignment 5 = middle-center).
    // Track/center: lower-middle third (Alignment 2 with large bottom margin).
    const fontsize = layout === 'split' ? style.fontsizeSplit : style.fontsizeDefault;
    const positioning = layout === 'split' ? '5,60,60,0' : '2,60,60,640';
    const defaultStyle = `Style: Default,${style.fontname},${fontsize},${style.baseColor},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,${style.outline},${style.shadow},${positioning},1`;

    let ass = `[Script Info]
Title: ViralClip Karaoke
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${defaultStyle}
Style: Title,${style.titleFontname},62,&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,1,6,2,8,70,70,140,1
Style: Emoji,Noto Emoji,84,&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,1,4,1,8,70,70,300,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const showEmoji = emoji && captionEmojisEnabled();
    if (hookTitle) {
        const titleEnd = Math.min(4.2, unitDur);
        const titleText = showEmoji ? `${hookTitle.toUpperCase()} ${emoji}` : hookTitle.toUpperCase();
        ass += `Dialogue: 1,${formatAssTime(0)},${formatAssTime(titleEnd)},Title,,0,0,0,,${titleText}\n`;
    } else if (showEmoji) {
        // No hook title → the emoji alone marks the tone during the hook
        ass += `Dialogue: 1,${formatAssTime(0)},${formatAssTime(Math.min(2.5, unitDur))},Emoji,,0,0,0,,${emoji}\n`;
    }

    // Group into lines: max 3 words, break on long pauses
    const lines: { word: string; start: number; end: number; isKeyword: boolean }[][] = [];
    let currentLine: typeof lines[number] = [];
    for (const w of clipWords) {
        const lastWord = currentLine[currentLine.length - 1];
        if (currentLine.length >= 3 || (lastWord && w.start - lastWord.end > 0.7)) {
            if (currentLine.length) lines.push(currentLine);
            currentLine = [];
        }
        currentLine.push(w);
    }
    if (currentLine.length) lines.push(currentLine);

    for (let li = 0; li < lines.length; li++) {
        const lineWords = lines[li];
        // Captions stay on screen through pauses: the finished line holds until
        // the next line starts (or up to 2.5s on long silences)
        const nextLineStart = li < lines.length - 1 ? lines[li + 1][0].start : unitDur;
        const lastWord = lineWords[lineWords.length - 1];
        const holdEnd = Math.max(lastWord.end, Math.min(lastWord.end + 2.5, nextLineStart));

        for (let i = 0; i < lineWords.length; i++) {
            const w = lineWords[i];
            const dialogStart = w.start;
            const dialogEnd = i < lineWords.length - 1 ? lineWords[i + 1].start : holdEnd;
            if (dialogEnd <= dialogStart) continue;

            const text = lineWords.map((lw, j) => {
                const token = style.uppercase ? lw.word.toUpperCase() : lw.word;
                return j === i ? style.activeToken(token, lw.isKeyword) : style.inactiveToken(token, lw.isKeyword);
            }).join(' ');

            ass += `Dialogue: 0,${formatAssTime(dialogStart)},${formatAssTime(dialogEnd)},Default,,0,0,0,,${text}\n`;
        }
    }

    fs.writeFileSync(subsPath, ass);
    return subsPath;
}

export function formatAssTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs}:${String(mins).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
}
