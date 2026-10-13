/**
 * Caption style registry — each style controls fonts, colors and how the
 * active karaoke word is rendered. Fonts live in assets/fonts (passed to
 * libass via fontsdir), so rendering never depends on system fonts.
 */
import path from 'path';
import type { CaptionStyleId } from '@/shared/types';

export const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts');

/** Colors are ASS &HAABBGGRR (BGR!) */
export interface CaptionStyle {
    id: CaptionStyleId;
    fontname: string;
    titleFontname: string;
    /** split layout = captions on the seam; default = lower-middle third */
    fontsizeSplit: number;
    fontsizeDefault: number;
    baseColor: string;
    keywordColor: string;
    outline: number;
    shadow: number;
    uppercase: boolean;
    /** ASS override tags for the word currently being spoken */
    activeToken: (token: string, isKeyword: boolean) => string;
    /** ASS override tags for the other words of the line */
    inactiveToken: (token: string, isKeyword: boolean) => string;
}

const YELLOW = '&H0000FFFF';
const GREEN = '&H0000FF00';
const WHITE = '&H00FFFFFF';
const SOFT_WHITE = '&H00F2F2F2';
const AMBER = '&H0030C8FF';

const current: CaptionStyle = {
    id: 'current',
    fontname: 'Arial Black',
    titleFontname: 'Arial Black',
    fontsizeSplit: 78,
    fontsizeDefault: 86,
    baseColor: WHITE,
    keywordColor: GREEN,
    outline: 9,
    shadow: 2,
    uppercase: true,
    activeToken: (token, isKeyword) =>
        `{\\c${isKeyword ? GREEN : YELLOW}\\fscx108\\fscy108}${token}{\\c${WHITE}\\fscx100\\fscy100}`,
    inactiveToken: (token, isKeyword) =>
        isKeyword ? `{\\c${GREEN}}${token}{\\c${WHITE}}` : token,
};

/** Hormozi-style: huge bold uppercase, yellow/green highlights, pop-in scale */
const hormozi: CaptionStyle = {
    id: 'hormozi',
    fontname: 'Archivo Black',
    titleFontname: 'Archivo Black',
    fontsizeSplit: 76,
    fontsizeDefault: 84,
    baseColor: WHITE,
    keywordColor: GREEN,
    outline: 11,
    shadow: 3,
    uppercase: true,
    activeToken: (token, isKeyword) =>
        `{\\c${isKeyword ? GREEN : YELLOW}\\fscx82\\fscy82\\t(0,110,\\fscx118\\fscy118)\\t(110,220,\\fscx108\\fscy108)}${token}{\\c${WHITE}\\fscx100\\fscy100}`,
    inactiveToken: (token, isKeyword) =>
        isKeyword ? `{\\c${GREEN}}${token}{\\c${WHITE}}` : token,
};

/** Clean: sentence case, soft shadow, subtle amber highlight, no jumps */
const clean: CaptionStyle = {
    id: 'clean',
    fontname: 'Poppins SemiBold',
    titleFontname: 'Poppins SemiBold',
    fontsizeSplit: 64,
    fontsizeDefault: 70,
    baseColor: SOFT_WHITE,
    keywordColor: AMBER,
    outline: 4,
    shadow: 1,
    uppercase: false,
    activeToken: (token, isKeyword) =>
        `{\\c${isKeyword ? AMBER : WHITE}\\fscx104\\fscy104}${token}{\\c${SOFT_WHITE}\\fscx100\\fscy100}`,
    inactiveToken: (token, isKeyword) =>
        isKeyword ? `{\\c${AMBER}}${token}{\\c${SOFT_WHITE}}` : token,
};

const STYLES: Record<CaptionStyleId, CaptionStyle> = { current, hormozi, clean };

export function getCaptionStyle(id?: CaptionStyleId): CaptionStyle {
    return STYLES[id ?? 'current'] ?? current;
}

export const CAPTION_STYLE_IDS: CaptionStyleId[] = ['current', 'hormozi', 'clean'];

export function captionEmojisEnabled(): boolean {
    return process.env.CAPTION_EMOJIS === '1';
}
