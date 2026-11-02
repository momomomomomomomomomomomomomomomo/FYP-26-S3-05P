'use strict';
/**
 * The palettes and motifs covers are drawn from.
 *
 * Split out of make-covers.js because the catalogue outgrew it: with seventy-odd
 * titles to draw, twelve palettes and twelve motifs could not give every book a
 * cover of its own. There are now enough combinations that no two titles share
 * a pair.
 *
 * A motif is a function of the palette, drawing into the top two thirds of a
 * 600x800 canvas. The bottom third is covered by a dark scrim at render time,
 * so nothing important belongs below y=440.
 */

const PALETTES = {
  dusk: { top: '#1e3a5f', bottom: '#4c6fa5', accent: '#ffd166', ink: '#ffffff', soft: '#8fb0d9' },
  meadow: { top: '#2d6a4f', bottom: '#74c69d', accent: '#ffe066', ink: '#ffffff', soft: '#b7e4c7' },
  ember: { top: '#9d2c2c', bottom: '#e8753d', accent: '#ffe8c2', ink: '#ffffff', soft: '#f4a261' },
  deep: { top: '#10243e', bottom: '#1f6f8b', accent: '#7fe3d4', ink: '#ffffff', soft: '#5b9ab5' },
  plum: { top: '#4a2545', bottom: '#8e5572', accent: '#ffd6e0', ink: '#ffffff', soft: '#c08497' },
  sand: { top: '#9c6644', bottom: '#e6ccb2', accent: '#3d348b', ink: '#3b2718', soft: '#ddb892' },
  frost: { top: '#1b4965', bottom: '#bee9e8', accent: '#f08080', ink: '#0b2b3c', soft: '#62b6cb' },
  moss: { top: '#344e41', bottom: '#a3b18a', accent: '#f4a259', ink: '#ffffff', soft: '#588157' },
  berry: { top: '#5f0f40', bottom: '#c9184a', accent: '#ffd6a5', ink: '#ffffff', soft: '#ff758f' },
  slate: { top: '#2b2d42', bottom: '#8d99ae', accent: '#ef233c', ink: '#ffffff', soft: '#adb5bd' },
  citrus: { top: '#bc6c25', bottom: '#dda15e', accent: '#283618', ink: '#ffffff', soft: '#fefae0' },
  lagoon: { top: '#006d77', bottom: '#83c5be', accent: '#ffddd2', ink: '#ffffff', soft: '#45a29e' },

  ink: { top: '#0b132b', bottom: '#3a506b', accent: '#5bc0be', ink: '#ffffff', soft: '#6b7f99' },
  jungle: { top: '#1b4332', bottom: '#40916c', accent: '#f6bd60', ink: '#ffffff', soft: '#52b788' },
  harvest: { top: '#774936', bottom: '#d4a373', accent: '#faedcd', ink: '#ffffff', soft: '#ccd5ae' },
  storm: { top: '#22223b', bottom: '#4a4e69', accent: '#f2e9e4', ink: '#ffffff', soft: '#9a8c98' },
  mint: { top: '#14746f', bottom: '#8ecfc9', accent: '#ffb703', ink: '#06302e', soft: '#4cb3ad' },
  cocoa: { top: '#432818', bottom: '#99582a', accent: '#ffe6a7', ink: '#ffffff', soft: '#bb9457' },
  dawn: { top: '#6a4c93', bottom: '#ff9b85', accent: '#ffe66d', ink: '#ffffff', soft: '#d88c9a' },
  ocean: { top: '#03045e', bottom: '#0077b6', accent: '#90e0ef', ink: '#ffffff', soft: '#48cae4' },
  violet: { top: '#3c096c', bottom: '#9d4edd', accent: '#ffd60a', ink: '#ffffff', soft: '#c77dff' },
  brass: { top: '#582f0e', bottom: '#b08968', accent: '#ffe8d6', ink: '#ffffff', soft: '#ddb892' },
  pine: { top: '#0b2b26', bottom: '#2f6d5f', accent: '#f5cb5c', ink: '#ffffff', soft: '#4f9a8a' },
  rose: { top: '#6d213c', bottom: '#d88c9a', accent: '#f2e9e4', ink: '#ffffff', soft: '#e0a0ae' },
  clay: { top: '#7f4f24', bottom: '#dda15e', accent: '#606c38', ink: '#ffffff', soft: '#e9c46a' },
  night: { top: '#0d1b2a', bottom: '#415a77', accent: '#e0e1dd', ink: '#ffffff', soft: '#778da9' },
  coral: { top: '#9b2226', bottom: '#ee9b00', accent: '#e9d8a6', ink: '#ffffff', soft: '#ca6702' },
  fern: { top: '#233d1e', bottom: '#6a994e', accent: '#f2e8cf', ink: '#ffffff', soft: '#a7c957' },
};

// --- shared pieces ----------------------------------------------------------
/** A fixed pseudo-random walk, so a cover is drawn identically every time. */
function sprinkle(p, n, { colour = null, maxY = 430, minR = 1, maxR = 3.6 } = {}) {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let out = '';
  for (let i = 0; i < n; i += 1) {
    const x = Math.round(rand() * 580 + 10);
    const y = Math.round(rand() * (maxY - 20) + 20);
    const r = (rand() * (maxR - minR) + minR).toFixed(1);
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="${colour || p.ink}" opacity="${(rand() * 0.5 + 0.35).toFixed(2)}"/>`;
  }
  return out;
}

const stars = (p, n) => sprinkle(p, n);

function clouds(p) {
  return [[120, 160, 1], [470, 120, 0.75], [250, 110, 0.5]].map(([x, y, s]) => `
    <g transform="translate(${x} ${y}) scale(${s})" fill="${p.ink}" opacity=".3">
      <circle cx="0" cy="0" r="34"/><circle cx="34" cy="8" r="26"/><circle cx="-32" cy="10" r="24"/>
      <rect x="-32" y="0" width="68" height="22" rx="11"/>
    </g>`).join('');
}

function hills(p, baseY = 400) {
  return `<path d="M0,${baseY} Q150,${baseY - 70} 300,${baseY} T600,${baseY} V470 H0 Z" fill="${p.soft}" opacity=".55"/>`;
}

const MOTIFS = {
  moon: (p) => `
    <circle cx="300" cy="300" r="118" fill="${p.accent}" opacity=".95"/>
    <circle cx="258" cy="268" r="24" fill="${p.bottom}" opacity=".25"/>
    <circle cx="332" cy="330" r="16" fill="${p.bottom}" opacity=".2"/>
    ${stars(p, 26)}`,

  rocket: (p) => `
    ${stars(p, 30)}
    <g transform="translate(300 300)">
      <path d="M0,-110 C38,-60 52,-10 52,34 L-52,34 C-52,-10 -38,-60 0,-110 Z" fill="${p.accent}"/>
      <circle cx="0" cy="-30" r="24" fill="${p.top}" opacity=".85"/>
      <path d="M-52,10 L-92,62 L-52,46 Z" fill="${p.soft}"/>
      <path d="M52,10 L92,62 L52,46 Z" fill="${p.soft}"/>
      <path d="M-26,34 C-14,78 14,78 26,34 Z" fill="${p.bottom}" opacity=".9"/>
    </g>`,

  waves: (p) => `
    <path d="M0,330 Q75,300 150,330 T300,330 T450,330 T600,330 V460 H0 Z" fill="${p.soft}" opacity=".55"/>
    <path d="M0,372 Q75,342 150,372 T300,372 T450,372 T600,372 V460 H0 Z" fill="${p.accent}" opacity=".5"/>
    <g transform="translate(300 268)">
      <path d="M-70,44 L70,44 L50,80 L-50,80 Z" fill="${p.accent}"/>
      <path d="M0,-66 L0,44 M0,-66 L58,30 L0,30 Z" fill="${p.ink}" opacity=".9" stroke="${p.ink}" stroke-width="5"/>
    </g>`,

  forest: (p) => `
    ${[90, 190, 300, 410, 510].map((x, i) => tree(p, x, 390, 0.7 + (i % 3) * 0.18)).join('')}
    <circle cx="470" cy="150" r="54" fill="${p.accent}" opacity=".9"/>`,

  mountains: (p) => `
    <circle cx="150" cy="160" r="48" fill="${p.accent}" opacity=".9"/>
    <path d="M0,420 L170,200 L300,360 L410,250 L600,420 Z" fill="${p.soft}" opacity=".8"/>
    <path d="M170,200 L222,268 L118,268 Z" fill="${p.ink}" opacity=".75"/>
    <path d="M410,250 L452,306 L368,306 Z" fill="${p.ink}" opacity=".6"/>`,

  kite: (p) => `
    ${clouds(p)}
    <g transform="translate(330 250) rotate(-12)">
      <path d="M0,-80 L58,0 L0,80 L-58,0 Z" fill="${p.accent}"/>
      <path d="M0,-80 L0,80 M-58,0 L58,0" stroke="${p.top}" stroke-width="4" opacity=".55"/>
      <path d="M0,80 C18,110 -18,138 0,168 C18,196 -10,214 0,236" fill="none" stroke="${p.ink}" stroke-width="4" opacity=".8"/>
    </g>`,

  lantern: (p) => `
    ${stars(p, 18)}
    <g transform="translate(300 290)">
      <rect x="-54" y="-70" width="108" height="124" rx="16" fill="${p.accent}"/>
      <rect x="-34" y="-46" width="68" height="78" rx="10" fill="${p.top}" opacity=".35"/>
      <rect x="-64" y="-84" width="128" height="18" rx="8" fill="${p.soft}"/>
      <rect x="-64" y="52" width="128" height="18" rx="8" fill="${p.soft}"/>
      <path d="M0,-84 C0,-120 0,-130 0,-144" stroke="${p.ink}" stroke-width="5" fill="none" opacity=".8"/>
    </g>`,

  balloon: (p) => `
    ${clouds(p)}
    <g transform="translate(300 262)">
      <path d="M0,-108 C62,-108 96,-62 96,-18 C96,34 48,74 0,124 C-48,74 -96,34 -96,-18 C-96,-62 -62,-108 0,-108 Z" fill="${p.accent}"/>
      <path d="M-32,-104 C-14,-60 -14,34 0,124 M32,-104 C14,-60 14,34 0,124" stroke="${p.top}" stroke-width="4" fill="none" opacity=".4"/>
      <rect x="-24" y="126" width="48" height="36" rx="8" fill="${p.soft}"/>
    </g>`,

  magnifier: (p) => `
    <g transform="translate(290 290) rotate(-20)">
      <circle cx="0" cy="0" r="92" fill="none" stroke="${p.accent}" stroke-width="18"/>
      <circle cx="0" cy="0" r="78" fill="${p.ink}" opacity=".12"/>
      <rect x="-13" y="88" width="26" height="110" rx="12" fill="${p.accent}"/>
    </g>
    ${[160, 420, 200, 440].map((x, i) => `<circle cx="${x}" cy="${150 + i * 34}" r="7" fill="${p.soft}" opacity=".8"/>`).join('')}`,

  bones: (p) => `
    ${[90, 170, 500].map((x, i) => `<path d="M${x},400 q18,-${26 + i * 8} 36,0" fill="none" stroke="${p.soft}" stroke-width="7" opacity=".55"/>`).join('')}
    <g transform="translate(300 310)" fill="${p.accent}">
      <path d="M-150,78 C-150,40 -120,26 -92,26 C-86,-6 -62,-30 -28,-34 C-20,-66 4,-86 32,-86
               C62,-86 82,-64 82,-38 C82,-18 70,-4 54,4 C70,14 80,30 80,50 C80,66 72,78 72,78
               L46,78 C52,62 48,50 36,44 L-24,44 C-30,60 -34,70 -36,78 L-62,78
               C-58,64 -56,56 -58,48 C-86,52 -108,64 -116,78 Z"/>
      <circle cx="40" cy="-58" r="6" fill="${p.top}"/>
      <path d="M-150,78 C-186,70 -206,48 -212,22" fill="none" stroke="${p.accent}" stroke-width="14" stroke-linecap="round"/>
    </g>`,

  flowers: (p) => `
    ${[110, 230, 360, 490].map((x, i) => flower(p, x, 400 - (i % 2) * 40, 0.8 + (i % 2) * 0.25)).join('')}
    <circle cx="470" cy="140" r="44" fill="${p.accent}" opacity=".85"/>`,

  snow: (p) => `
    ${stars(p, 34)}
    <path d="M0,400 Q150,340 300,400 T600,400 V470 H0 Z" fill="${p.ink}" opacity=".18"/>
    <g transform="translate(300 268)" stroke="${p.accent}" stroke-width="7" stroke-linecap="round">
      ${[0, 60, 120].map((a) => `<path d="M-86,0 L86,0" transform="rotate(${a})"/>`).join('')}
      ${[0, 60, 120, 180, 240, 300].map((a) => `<path d="M58,0 L40,-18 M58,0 L40,18" transform="rotate(${a})"/>`).join('')}
    </g>`,

  castle: (p) => `
    ${stars(p, 16)}
    <g transform="translate(300 330)" fill="${p.accent}">
      <rect x="-150" y="-60" width="300" height="120" />
      <rect x="-170" y="-130" width="60" height="190"/>
      <rect x="110" y="-130" width="60" height="190"/>
      <rect x="-36" y="-170" width="72" height="230"/>
      ${[-170, -110, 110, 170].map((x) => `<rect x="${x - 10}" y="-146" width="20" height="20"/>`).join('')}
      <path d="M0,-170 L0,-230 L56,-206 L0,-186 Z" fill="${p.soft}"/>
      <path d="M-22,60 L-22,8 A22,22 0 0,1 22,8 L22,60 Z" fill="${p.top}" opacity=".7"/>
    </g>`,

  owl: (p) => `
    ${stars(p, 20)}
    <g transform="translate(300 300)">
      <ellipse cx="0" cy="10" rx="92" ry="110" fill="${p.accent}"/>
      <circle cx="-34" cy="-26" r="32" fill="${p.ink}" opacity=".92"/>
      <circle cx="34" cy="-26" r="32" fill="${p.ink}" opacity=".92"/>
      <circle cx="-34" cy="-26" r="13" fill="${p.top}"/>
      <circle cx="34" cy="-26" r="13" fill="${p.top}"/>
      <path d="M0,-6 L-16,16 L16,16 Z" fill="${p.top}"/>
      <path d="M-92,-30 L-60,-82 L-34,-54 Z M92,-30 L60,-82 L34,-54 Z" fill="${p.accent}"/>
      <path d="M-40,116 L-40,136 M40,116 L40,136" stroke="${p.soft}" stroke-width="10" stroke-linecap="round"/>
    </g>`,

  fish: (p) => `
    ${sprinkle(p, 26, { colour: p.soft, maxY: 420, maxR: 5 })}
    <g transform="translate(300 290)">
      <path d="M-110,0 C-70,-70 50,-70 92,0 C50,70 -70,70 -110,0 Z" fill="${p.accent}"/>
      <path d="M92,0 L148,-44 L148,44 Z" fill="${p.soft}"/>
      <circle cx="40" cy="-16" r="11" fill="${p.top}"/>
      <path d="M-40,-34 C-10,-6 -10,6 -40,34" fill="none" stroke="${p.top}" stroke-width="5" opacity=".45"/>
    </g>`,

  bee: (p) => `
    ${[[140, 170], [470, 140], [200, 390]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="26" fill="${p.soft}" opacity=".45"/>`).join('')}
    <g transform="translate(300 292) rotate(-10)">
      <ellipse cx="0" cy="0" rx="96" ry="62" fill="${p.accent}"/>
      ${[-40, 0, 40].map((x) => `<rect x="${x - 10}" y="-62" width="20" height="124" fill="${p.top}" opacity=".75"/>`).join('')}
      <circle cx="-96" cy="-6" r="34" fill="${p.top}" opacity=".9"/>
      <ellipse cx="10" cy="-70" rx="52" ry="28" fill="${p.ink}" opacity=".35" transform="rotate(-18)"/>
      <path d="M-120,-30 C-134,-56 -118,-66 -110,-54 M-120,-22 C-140,-36 -132,-54 -122,-44"
            fill="none" stroke="${p.top}" stroke-width="5"/>
    </g>`,

  train: (p) => `
    ${clouds(p)}
    <g transform="translate(300 320)" fill="${p.accent}">
      <rect x="-170" y="-50" width="190" height="86" rx="10"/>
      <rect x="30" y="-96" width="130" height="132" rx="12"/>
      <rect x="54" y="-72" width="38" height="38" rx="6" fill="${p.top}" opacity=".7"/>
      <rect x="104" y="-72" width="38" height="38" rx="6" fill="${p.top}" opacity=".7"/>
      <rect x="-186" y="-82" width="44" height="34" rx="8"/>
      ${[-130, -50, 70, 130].map((x) => `<circle cx="${x}" cy="48" r="26" fill="${p.soft}"/>`).join('')}
      <rect x="-200" y="74" width="400" height="8" rx="4" fill="${p.soft}" opacity=".7"/>
    </g>`,

  bicycle: (p) => `
    ${hills(p, 408)}
    <g transform="translate(300 300)" fill="none" stroke="${p.accent}" stroke-width="12" stroke-linecap="round">
      <circle cx="-96" cy="46" r="62"/>
      <circle cx="96" cy="46" r="62"/>
      <path d="M-96,46 L-24,-44 L60,-44 L96,46 M-24,-44 L24,46 L96,46 M60,-44 L84,-44"/>
      <path d="M-30,-56 L10,-56" stroke-width="10"/>
    </g>`,

  teacup: (p) => `
    <g transform="translate(300 310)">
      <path d="M-96,-30 L96,-30 L78,72 C78,92 -78,92 -78,72 Z" fill="${p.accent}"/>
      <path d="M96,-10 C150,-10 150,54 92,54" fill="none" stroke="${p.accent}" stroke-width="16"/>
      <ellipse cx="0" cy="-30" rx="96" ry="22" fill="${p.soft}"/>
      <path d="M-30,-70 C-30,-96 -10,-96 -10,-122 M14,-70 C14,-100 36,-100 36,-128"
            fill="none" stroke="${p.ink}" stroke-width="6" opacity=".55"/>
      <rect x="-130" y="88" width="260" height="14" rx="7" fill="${p.soft}" opacity=".8"/>
    </g>`,

  footprints: (p) => `
    ${hills(p, 420)}
    ${[[150, 380, -12], [230, 320, -8], [300, 262, -4], [374, 206, 2], [448, 152, 6]].map(([x, y, r], i) => `
      <g transform="translate(${x} ${y}) rotate(${r}) scale(${0.9 - i * 0.07})" fill="${p.accent}" opacity="${1 - i * 0.12}">
        <ellipse cx="0" cy="0" rx="26" ry="34"/>
        ${[-20, -4, 14, 28].map((dx, j) => `<circle cx="${dx}" cy="${-40 - (j % 2) * 8}" r="9"/>`).join('')}
      </g>`).join('')}`,

  umbrella: (p) => `
    ${[...Array(18)].map((_, i) => `<path d="M${40 + i * 32},${120 + (i % 4) * 70} l-10,34" stroke="${p.soft}" stroke-width="5" stroke-linecap="round" opacity=".6"/>`).join('')}
    <g transform="translate(300 300)">
      <path d="M-130,10 A130,130 0 0,1 130,10 Z" fill="${p.accent}"/>
      <path d="M-130,10 A44,44 0 0,1 -42,10 A44,44 0 0,1 46,10 A44,44 0 0,1 130,10"
            fill="none" stroke="${p.top}" stroke-width="5" opacity=".45"/>
      <path d="M0,10 L0,112 C0,136 -34,136 -34,112" fill="none" stroke="${p.ink}" stroke-width="9" stroke-linecap="round" opacity=".85"/>
    </g>`,

  book: (p) => `
    ${stars(p, 14)}
    <g transform="translate(300 300)">
      <path d="M-140,-70 C-90,-96 -30,-96 0,-74 C30,-96 90,-96 140,-70 L140,74 C90,48 30,48 0,70 C-30,48 -90,48 -140,74 Z" fill="${p.accent}"/>
      <path d="M0,-74 L0,70" stroke="${p.top}" stroke-width="6" opacity=".5"/>
      ${[-24, 0, 24].map((dy) => `<path d="M-112,${dy} L-26,${dy - 8} M26,${dy - 8} L112,${dy}" stroke="${p.top}" stroke-width="5" opacity=".28"/>`).join('')}
    </g>`,

  drum: (p) => `
    ${sprinkle(p, 18, { colour: p.accent, maxY: 220, maxR: 4 })}
    <g transform="translate(300 310)">
      <ellipse cx="0" cy="-54" rx="118" ry="34" fill="${p.soft}"/>
      <path d="M-118,-54 L-118,46 A118,34 0 0,0 118,46 L118,-54 Z" fill="${p.accent}"/>
      ${[-80, -26, 28, 82].map((x, i) => `<path d="M${x},-40 L${x + 26},40" stroke="${p.top}" stroke-width="6" opacity=".4"/>`).join('')}
      <path d="M-150,-120 L-70,-62 M150,-120 L70,-62" stroke="${p.ink}" stroke-width="9" stroke-linecap="round" opacity=".85"/>
    </g>`,

  feather: (p) => `
    ${sprinkle(p, 20, { colour: p.soft, maxY: 420, maxR: 3 })}
    <g transform="translate(300 300) rotate(16)">
      <path d="M0,130 C0,40 14,-60 52,-130 C92,-56 84,40 36,120 Z" fill="${p.accent}"/>
      <path d="M0,130 C0,40 14,-60 52,-130" fill="none" stroke="${p.top}" stroke-width="5" opacity=".5"/>
      ${[...Array(7)].map((_, i) => `<path d="M${10 + i * 5},${96 - i * 28} L${48 + i * 3},${72 - i * 28}" stroke="${p.top}" stroke-width="3" opacity=".3"/>`).join('')}
    </g>`,

  clock: (p) => `
    <g transform="translate(300 300)">
      <circle cx="0" cy="0" r="124" fill="${p.accent}"/>
      <circle cx="0" cy="0" r="104" fill="${p.top}" opacity=".25"/>
      ${[...Array(12)].map((_, i) => `<rect x="-4" y="-104" width="8" height="${i % 3 === 0 ? 24 : 14}" rx="4" fill="${p.top}" transform="rotate(${i * 30})" opacity=".8"/>`).join('')}
      <path d="M0,0 L0,-66" stroke="${p.ink}" stroke-width="10" stroke-linecap="round"/>
      <path d="M0,0 L48,26" stroke="${p.ink}" stroke-width="8" stroke-linecap="round"/>
      <circle cx="0" cy="0" r="10" fill="${p.ink}"/>
    </g>`,

  lightning: (p) => `
    <g opacity=".35" fill="${p.ink}">
      <circle cx="160" cy="150" r="44"/><circle cx="214" cy="162" r="34"/><circle cx="110" cy="166" r="30"/>
      <circle cx="430" cy="128" r="38"/><circle cx="474" cy="140" r="28"/><circle cx="388" cy="142" r="26"/>
      <rect x="110" y="150" width="104" height="26" rx="13"/><rect x="388" y="128" width="86" height="24" rx="12"/>
    </g>
    <path d="M318,180 L242,320 L300,320 L250,430 L370,284 L306,284 Z" fill="${p.accent}"/>`,

  cave: (p) => `
    <path d="M0,440 L0,250 C70,170 150,120 260,112 C380,104 500,170 600,260 L600,440 Z"
          fill="${p.soft}" opacity=".6"/>
    <path d="M190,440 C190,330 232,268 300,268 C368,268 410,330 410,440 Z" fill="#0a0f16" opacity=".88"/>
    ${[232, 268, 332, 368].map((x, i) => `<path d="M${x},272 l9,${24 + (i % 2) * 16} l9,-${24 + (i % 2) * 16} Z" fill="${p.soft}" opacity=".5"/>`).join('')}
    <circle cx="300" cy="372" r="16" fill="${p.accent}" opacity=".95"/>
    <circle cx="300" cy="372" r="34" fill="${p.accent}" opacity=".22"/>
    ${[120, 470].map((x, i) => `<path d="M${x},440 l${24 + i * 10},-${58 + i * 14} l${24 + i * 10},${58 + i * 14} Z" fill="${p.top}" opacity=".5"/>`).join('')}`,

  crown: (p) => `
    ${stars(p, 20)}
    <g transform="translate(300 300)" fill="${p.accent}">
      <path d="M-136,54 L-116,-70 L-56,-6 L0,-96 L56,-6 L116,-70 L136,54 Z"/>
      <rect x="-136" y="54" width="272" height="34" rx="10"/>
      <circle cx="-116" cy="-82" r="14"/><circle cx="0" cy="-110" r="16"/><circle cx="116" cy="-82" r="14"/>
      <circle cx="0" cy="70" r="11" fill="${p.top}" opacity=".6"/>
      <circle cx="-66" cy="70" r="9" fill="${p.top}" opacity=".6"/>
      <circle cx="66" cy="70" r="9" fill="${p.top}" opacity=".6"/>
    </g>`,

  map: (p) => `
    <g transform="translate(300 294) rotate(-4)">
      <path d="M-170,-110 L-56,-80 L58,-114 L170,-84 L170,110 L58,80 L-56,114 L-170,84 Z" fill="${p.accent}"/>
      <path d="M-56,-80 L-56,114 M58,-114 L58,80" stroke="${p.top}" stroke-width="4" opacity=".35"/>
      <path d="M-140,40 C-80,-10 -10,60 60,0 C110,-40 140,-10 150,10" fill="none"
            stroke="${p.top}" stroke-width="6" stroke-dasharray="14 12" opacity=".65"/>
      <path d="M120,-44 l14,24 l-28,0 Z" fill="${p.top}" opacity=".7"/>
      <path d="M-116,-30 l-14,26 l28,0 Z" fill="${p.top}" opacity=".5"/>
    </g>`,

  window: (p) => `
    ${stars(p, 22)}
    <g transform="translate(300 290)">
      <rect x="-124" y="-130" width="248" height="260" rx="14" fill="${p.accent}"/>
      <rect x="-104" y="-110" width="92" height="110" rx="8" fill="${p.top}" opacity=".55"/>
      <rect x="12" y="-110" width="92" height="110" rx="8" fill="${p.top}" opacity=".55"/>
      <rect x="-104" y="16" width="92" height="94" rx="8" fill="${p.top}" opacity=".55"/>
      <rect x="12" y="16" width="92" height="94" rx="8" fill="${p.top}" opacity=".55"/>
      <circle cx="58" cy="-62" r="22" fill="${p.soft}" opacity=".9"/>
    </g>`,

  leaf: (p) => `
    ${sprinkle(p, 16, { colour: p.accent, maxY: 420, maxR: 4 })}
    <g transform="translate(300 290) rotate(-18)">
      <path d="M0,140 C-110,60 -110,-80 0,-150 C110,-80 110,60 0,140 Z" fill="${p.accent}"/>
      <path d="M0,140 L0,-150" stroke="${p.top}" stroke-width="6" opacity=".5"/>
      ${[...Array(6)].map((_, i) => `<path d="M0,${90 - i * 42} L${-58 + i * 3},${50 - i * 42} M0,${90 - i * 42} L${58 - i * 3},${50 - i * 42}"
        stroke="${p.top}" stroke-width="4" opacity=".32"/>`).join('')}
    </g>`,

  house: (p) => `
    ${hills(p, 410)}
    <g transform="translate(300 310)">
      <path d="M-150,-20 L0,-140 L150,-20 Z" fill="${p.accent}"/>
      <rect x="-116" y="-20" width="232" height="130" fill="${p.soft}"/>
      <rect x="-30" y="30" width="60" height="80" rx="6" fill="${p.top}" opacity=".75"/>
      <rect x="-92" y="6" width="44" height="44" rx="6" fill="${p.accent}" opacity=".95"/>
      <rect x="48" y="6" width="44" height="44" rx="6" fill="${p.accent}" opacity=".95"/>
      <rect x="70" y="-108" width="30" height="56" fill="${p.accent}"/>
    </g>`,

  boat: (p) => `
    ${stars(p, 22)}
    <path d="M0,372 Q75,348 150,372 T300,372 T450,372 T600,372 V460 H0 Z" fill="${p.soft}" opacity=".5"/>
    <g transform="translate(300 300)">
      <path d="M-120,40 L120,40 L88,96 L-88,96 Z" fill="${p.accent}"/>
      <rect x="-6" y="-110" width="12" height="150" fill="${p.ink}" opacity=".85"/>
      <path d="M6,-104 L96,24 L6,24 Z" fill="${p.soft}"/>
      <path d="M-6,-86 L-80,24 L-6,24 Z" fill="${p.accent}" opacity=".85"/>
    </g>`,

  sun: (p) => `
    <g transform="translate(300 280)">
      <circle cx="0" cy="0" r="92" fill="${p.accent}"/>
      ${[...Array(12)].map((_, i) => `<rect x="-6" y="-152" width="12" height="40" rx="6" fill="${p.accent}" transform="rotate(${i * 30})" opacity=".9"/>`).join('')}
    </g>
    ${hills(p, 420)}`,

  gears: (p) => `
    ${[[230, 250, 1], [390, 320, 0.72], [300, 390, 0.5]].map(([x, y, s]) => `
      <g transform="translate(${x} ${y}) scale(${s})" fill="${p.accent}">
        ${[...Array(10)].map((_, i) => `<rect x="-11" y="-104" width="22" height="34" rx="5" transform="rotate(${i * 36})"/>`).join('')}
        <circle cx="0" cy="0" r="76"/><circle cx="0" cy="0" r="30" fill="${p.top}" opacity=".7"/>
      </g>`).join('')}`,

  bird: (p) => `
    ${clouds(p)}
    <g transform="translate(300 290)">
      <ellipse cx="0" cy="20" rx="86" ry="62" fill="${p.accent}"/>
      <circle cx="-66" cy="-34" r="40" fill="${p.accent}"/>
      <path d="M-100,-40 L-150,-26 L-100,-14 Z" fill="${p.soft}"/>
      <circle cx="-76" cy="-44" r="8" fill="${p.top}"/>
      <path d="M10,0 C60,-40 110,-28 124,10 C90,34 36,34 10,0 Z" fill="${p.soft}"/>
      <path d="M70,60 L150,96 L74,84 Z" fill="${p.accent}" opacity=".9"/>
    </g>`,
};

function tree(p, x, baseY, scale) {
  return `<g transform="translate(${x} ${baseY}) scale(${scale})">
    <rect x="-9" y="-30" width="18" height="60" rx="5" fill="${p.ink}" opacity=".55"/>
    <path d="M0,-150 L58,-50 L-58,-50 Z" fill="${p.soft}"/>
    <path d="M0,-110 L48,-18 L-48,-18 Z" fill="${p.accent}" opacity=".85"/>
  </g>`;
}

function flower(p, x, baseY, scale) {
  return `<g transform="translate(${x} ${baseY}) scale(${scale})">
    <path d="M0,0 L0,-78" stroke="${p.soft}" stroke-width="7" fill="none"/>
    ${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-104" rx="17" ry="30" fill="${p.accent}" transform="rotate(${a} 0 -78)"/>`).join('')}
    <circle cx="0" cy="-78" r="15" fill="${p.ink}" opacity=".8"/>
  </g>`;
}

module.exports = { PALETTES, MOTIFS };
