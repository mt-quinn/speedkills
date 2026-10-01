// Stable crew portraits; artist and license details in assets/portraits/CREDITS.md.
const PORTRAITS = {
  "Kaplan": "astronaut-helmet.svg",
  "Adeyemi": "alien-stare.svg",
  "Petrov": "cyborg-face.svg",
  "Voss": "kenku-head.svg",
  "Oyelaran": "robot-helmet.svg",
  "Duarte": "lynx-head.svg",
  "Rourke": "dwarf-face.svg",
  "Okoye": "squid-head.svg",
  "Ito": "goblin-head.svg",
  "Quist": "woman-elf-face.svg",
  "Chen": "metal-golem-head.svg",
  "Tanaka": "android-mask.svg",
  "Brennan": "police-officer-head.svg",
  "Fairweather": "wolf-head.svg",
  "Sato": "mining-helmet.svg",
  "Abara": "alien-bug.svg",
  "Moreau": "eagle-head.svg",
  "Delacroix": "mecha-head.svg",
  "Salazar": "orc-head.svg",
  "Novak": "monk-face.svg",
  "Osei": "space-suit.svg",
  "Varga": "raccoon-head.svg",
  "Liang": "golem-head.svg",
  "Reyes": "robot-antennas.svg",
  "Achebe": "viking-head.svg",
  "Nakamura": "six-eyes.svg",
  "Kowalski": "diving-helmet.svg",
  "Mendez": "mandrill-head.svg",
  "Sørensen": "sauropod-head.svg",
  "Iyer": "tiger-head.svg",
  "Castellanos": "robot-golem.svg",
  "Lindgren": "wizard-face.svg",
  "Amari": "bear-head.svg",
  "Haddad": "tribal-mask.svg",
  "Brandt": "rabbit-head.svg",
  "Kwan": "vintage-robot.svg",
  "Mbeki": "warlock-hood.svg",
  "Vasquez": "triceratops-head.svg",
  "Hollis": "triton-head.svg",
  "Lindqvist": "walrus-head.svg"
};
const GENERATED_PORTRAITS = [...new Set(Object.values(PORTRAITS))];
const COLORS = ["#d4bb8a", "#a4bda7", "#adb9cc", "#c9a2a0", "#b5aed0", "#a3bbb9"];
export function portrait(name) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return { file: PORTRAITS[name] || GENERATED_PORTRAITS[hash % GENERATED_PORTRAITS.length], color: COLORS[hash % COLORS.length] };
}
