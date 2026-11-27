/* Shroom Log: offline mushroom key and anatomy guide.
   A key narrows things down to a group. It never confirms that anything is safe to eat. */

const KEY = {
  start: { q: "What does it look like overall?", opts: [
    ["A shelf or bracket on wood, with no stem or a short side stem", "shelf"],
    ["A cap on a stem", "capstem"],
    ["A ball or pear shape, with no cap or stem", "ball"],
    ["Something else: honeycomb, coral, jelly, crust or cup", "odd"]
  ] },
  shelf: { q: "Look underneath. What is there?", opts: [
    ["Tiny holes (pores), like a sponge", "shelfPores"],
    ["Gills, like the pages of a book", "L_shelfGills"],
    ["Hanging teeth or spines", "L_teeth"],
    ["Smooth, wrinkled or crust-like", "L_crust"]
  ] },
  shelfPores: { q: "Which fits best?", opts: [
    ["Soft and fleshy, bright orange to yellow on top, yellow or white underneath", "L_chicken"],
    ["Many grey-brown frond-like caps in a rosette at the base of a tree", "L_hen"],
    ["Shiny, varnished red-brown top, white pores, corky", "L_reishi"],
    ["Black, cracked, charcoal-like lump on birch, orange-brown inside", "L_chaga"],
    ["Thin, tough and leathery, or hard and woody", "L_polypore"]
  ] },
  capstem: { q: "Look under the cap. What is there?", opts: [
    ["Gills: thin blades", "gills"],
    ["A spongy layer of pores", "L_bolete"],
    ["Teeth or spines", "L_hedgehog"],
    ["Blunt, forked ridges that run down the stem, not true gills", "L_chanterelle"],
    ["Nothing much: smooth or slightly wrinkled, and the whole thing is a dark trumpet", "L_trumpet"]
  ] },
  gills: { q: "Check the base and the stem. Dig the whole thing up so the base comes out intact.", opts: [
    ["A cup or sac around the base (volva), or a ring with white gills", "L_amanita"],
    ["Growing in a tight cluster on wood or buried roots", "gillsWood"],
    ["A tall white shaggy cylinder whose gills turn to black ink", "L_shaggy"],
    ["A large wine-red to brown cap with a ring, on wood chips or mulch", "L_winecap"],
    ["None of these", "spore"]
  ] },
  gillsWood: { q: "Which fits best?", opts: [
    ["Bright orange all over, gills running down the stem", "L_jack"],
    ["Long thin stems, small sticky caps, in winter on wood", "L_enoki"],
    ["Honey to brown caps, a ring on the stem, in big clumps in autumn", "L_honey"],
    ["Small brown caps with a ring, on rotting wood", "L_galerina"]
  ] },
  spore: { q: "Make a spore print: leave the cap gills-down on white and black paper for a few hours. What colour is it?", opts: [
    ["White or cream", "L_sWhite"],
    ["Pink to salmon", "L_sPink"],
    ["Rusty or cinnamon brown", "L_sBrown"],
    ["Chocolate, purple-brown or black", "L_sDark"]
  ] },
  ball: { q: "Cut it in half from top to bottom. What is inside?", opts: [
    ["Pure white all the way through, even and firm like marshmallow", "L_puffball"],
    ["The outline of a little cap, gills or stem", "L_egg"],
    ["Firm and purple-black or marbled, with a thick skin", "L_earthball"],
    ["Yellow, olive or brown and powdery", "L_oldpuff"]
  ] },
  odd: { q: "Which is it most like?", opts: [
    ["A honeycomb cap, hollow from the tip to the base", "L_morel"],
    ["A brain-like or saddle-shaped cap, wrinkled, with cottony stuffing inside", "L_falsemorel"],
    ["Bright orange-red and hard, as if a mushroom had been painted over", "L_lobster"],
    ["Brown, rubbery and ear-shaped, on wood", "L_woodear"],
    ["Branching like coral", "L_coral"],
    ["A cup or disc", "L_cup"]
  ] },

  L_shelfGills: { leaf: true, sev: "guide", title: "Oyster-type mushrooms, or other gilled shelves", guides: ["oyster"], text: "Oysters have white to cream gills running down a short side stem, a mild smell and a white to lilac spore print. Angel wings (thin, pure white, on conifers) are best avoided. Hairy or tough shelves are other species." },
  L_teeth: { leaf: true, sev: "guide", title: "Lion's mane and bear's head (Hericium)", guides: ["lionsmane", "bearshead"], text: "White cascades of soft spines on hardwood. They have no close toxic lookalikes in our region, which is why they're taught early." },
  L_crust: { leaf: true, sev: "expert", title: "Crust and parchment fungi", text: "Usually thin and tough. Interesting to log, but not food." },
  L_chicken: { leaf: true, sev: "guide", title: "Chicken of the woods (Laetiporus)", guides: ["chicken"], text: "Avoid any growing on conifers, eucalyptus or locust, and cook it well. Some people react to it even so." },
  L_hen: { leaf: true, sev: "guide", title: "Hen of the woods (maitake)", guides: ["hen"], text: "Check it isn't black-staining polypore or the tough, white-pored Berkeley's polypore." },
  L_reishi: { leaf: true, sev: "guide", title: "Reishi (Ganoderma)", guides: ["reishi"], text: "Too woody to eat. It's used for tea. Similar shiny polypores exist on conifers." },
  L_chaga: { leaf: true, sev: "guide", title: "Chaga (Inonotus obliquus)", guides: ["chaga"], text: "Only on birch. Harvest a little and leave the rest so the tree and the fungus keep going." },
  L_polypore: { leaf: true, sev: "expert", title: "Tough polypores, such as turkey tail", text: "Mostly too tough to eat. Turkey tail has a fine pored underside; false turkey tail has a smooth underside." },
  L_bolete: { leaf: true, sev: "guide", title: "Boletes (porcini and relatives)", guides: ["porcini"], text: "Beginners should skip any with red or orange pores, and any that quickly bruise blue. Taste a tiny bit and spit it out: bitter means a bitter bolete." },
  L_hedgehog: { leaf: true, sev: "guide", title: "Hedgehog mushroom (Hydnum)", guides: ["hedgehog"], text: "Soft spines under a pale orange cap, on the ground. A good beginner group." },
  L_chanterelle: { leaf: true, sev: "guide", title: "Chanterelles", guides: ["chanterelle"], text: "Check for jack-o'-lantern (toxic, true gills, on wood in clusters) and false chanterelle (true forked gills, orange)." },
  L_trumpet: { leaf: true, sev: "guide", title: "Black trumpet (Craterellus)", guides: ["blacktrumpet"], text: "Hollow, thin and funnel-shaped, grey to black, often in moss under oaks." },
  L_amanita: { leaf: true, sev: "deadly", title: "Possible Amanita: the deadliest group", text: "Death caps and destroying angels kill people every year. A volva, a ring and white gills together are classic warning signs. Do not eat it, and wash your hands after handling it." },
  L_jack: { leaf: true, sev: "toxic", title: "Jack-o'-lantern (Omphalotus)", text: "Toxic: it causes severe vomiting. Often mistaken for chanterelles, but it has true, sharp gills and grows in clusters on wood." },
  L_enoki: { leaf: true, sev: "guide", title: "Velvet foot (wild enoki)", guides: ["enoki"], text: "Deadly Galerina grows in the same places and seasons. Check every stem: velvet foot has a dark velvety stem and a white spore print, and no ring." },
  L_honey: { leaf: true, sev: "expert", title: "Honey mushrooms (Armillaria)", text: "Eaten by some, but they look like deadly Galerina and toxic lookalikes. Get an expert to check before eating, and always cook well." },
  L_galerina: { leaf: true, sev: "deadly", title: "Possible Galerina: deadly", text: "Small brown mushrooms with a ring on wood can contain the same toxins as the death cap. Never eat little brown mushrooms." },
  L_shaggy: { leaf: true, sev: "guide", title: "Shaggy mane (Coprinus comatus)", guides: ["shaggymane"], text: "Pick young and cook the same day. Don't drink alcohol with the related common ink cap." },
  L_winecap: { leaf: true, sev: "guide", title: "Wine cap (Stropharia rugosoannulata)", guides: ["winecap"], text: "Purple-black spore print and a cogwheel ring. Check carefully for toxic brown-spored lookalikes in mulch." },
  L_sWhite: { leaf: true, sev: "expert", title: "White-spored gilled mushrooms", text: "This group includes deadly Amanitas and toxic Clitocybes as well as good edibles. Leave these to an expert." },
  L_sPink: { leaf: true, sev: "toxic", title: "Pink-spored gilled mushrooms", text: "Entoloma species here are a common cause of poisoning. Not for beginners." },
  L_sBrown: { leaf: true, sev: "deadly", title: "Rusty-brown spores: Cortinarius, Galerina and others", text: "Some contain toxins that destroy the kidneys or liver, with symptoms days later. Avoid this whole group." },
  L_sDark: { leaf: true, sev: "expert", title: "Dark-spored gilled mushrooms (Agaricus, Psathyrella and others)", text: "Includes field mushrooms, but also yellow stainers that make people ill. Leave these to an expert." },
  L_puffball: { leaf: true, sev: "guide", title: "True puffball", guides: ["puffball"], text: "Every single one must be cut top to bottom, and must be pure white with no outline inside." },
  L_egg: { leaf: true, sev: "deadly", title: "An Amanita egg: deadly", text: "Young Amanitas look like puffballs until you cut them. That outline inside is a growing mushroom. Throw it away." },
  L_earthball: { leaf: true, sev: "toxic", title: "Earthball (Scleroderma)", text: "Toxic. Firm and dark inside from a young age." },
  L_oldpuff: { leaf: true, sev: "expert", title: "An old puffball", text: "Past eating. The powder is spores, so don't breathe it in." },
  L_morel: { leaf: true, sev: "guide", title: "True morel", guides: ["morel"], text: "Slice it lengthwise: it must be one hollow chamber, with the cap joined to the stem. Always cook well." },
  L_falsemorel: { leaf: true, sev: "deadly", title: "False morel (Gyromitra)", text: "Contains a toxin that can kill. The brain-like cap and cottony inside tell it apart from a true morel." },
  L_lobster: { leaf: true, sev: "guide", title: "Lobster mushroom", guides: ["lobster"], text: "A mould growing over another mushroom. Pick only firm, bright ones." },
  L_woodear: { leaf: true, sev: "guide", title: "Wood ear (Auricularia)", guides: ["woodear"], text: "Rubbery, translucent and ear-shaped. Cook well." },
  L_coral: { leaf: true, sev: "expert", title: "Coral fungi", text: "Some upset the stomach and they're hard to tell apart. Leave them to an expert." },
  L_cup: { leaf: true, sev: "expert", title: "Cup fungi", text: "Mostly small and not food. Note them in your log for interest." }
};

const ANATOMY_SVG = `<svg viewBox="0 0 420 330" role="img" aria-label="Labelled diagram of a mushroom" style="width:100%;max-width:520px;display:block;margin:0 auto">
  <g fill="none" stroke="var(--muted)" stroke-width="1.2" stroke-linecap="round">
    <path d="M150 290 q-20 14 -46 18 M168 292 q-6 18 -22 30 M194 292 q10 16 30 26 M210 288 q24 10 46 10" opacity=".7"/>
  </g>
  <path d="M60 128 C66 60 124 30 180 30 C236 30 294 60 300 128 Z" fill="#e9a75e"/>
  <circle cx="140" cy="70" r="6" fill="#f6e6cf" opacity=".85"/><circle cx="200" cy="56" r="5" fill="#f6e6cf" opacity=".85"/><circle cx="240" cy="84" r="6" fill="#f6e6cf" opacity=".85"/><circle cx="110" cy="102" r="4" fill="#f6e6cf" opacity=".85"/>
  <path d="M60 128 L300 128 L262 146 L98 146 Z" fill="#f3ead9"/>
  <g stroke="#cbbfa8" stroke-width="1.2">${Array.from({ length: 17 }, (_, i) => { const x = 70 + i * 13.75; const bx = 106 + i * 9.25; return `<line x1="${x}" y1="129" x2="${bx}" y2="145"/>`; }).join("")}</g>
  <path d="M162 146 L198 146 L204 270 L156 270 Z" fill="#ede6d8"/>
  <path d="M150 170 Q180 186 210 170 L206 182 Q180 196 154 182 Z" fill="#d9d0bd"/>
  <path d="M140 296 C138 270 152 258 180 258 C208 258 222 270 220 296 Z" fill="#cfc4ae"/>
  <path d="M146 278 Q180 266 214 278" fill="none" stroke="#b5a990" stroke-width="1.5"/>
  <g fill="none" stroke="var(--fg)" stroke-width="1" opacity=".75">
    <line x1="250" y1="60" x2="312" y2="34"/><line x1="292" y1="124" x2="322" y2="110"/><line x1="240" y1="138" x2="318" y2="160"/>
    <line x1="208" y1="176" x2="318" y2="206"/><line x1="200" y1="230" x2="318" y2="244"/><line x1="216" y1="284" x2="318" y2="282"/>
    <line x1="150" y1="58" x2="40" y2="26"/><line x1="104" y1="300" x2="40" y2="306"/>
  </g>
  <g font-family="inherit" font-size="13" fill="var(--fg)" font-weight="700">
    <text x="316" y="38">Cap</text><text x="326" y="114">Margin</text><text x="322" y="164">Gills</text><text x="322" y="210">Ring</text>
    <text x="322" y="248">Stem</text><text x="322" y="286">Volva</text><text x="2" y="22">Warts</text><text x="2" y="312">Mycelium</text>
  </g>
</svg>`;

const ANATOMY = [
  ["Cap (pileus)", "The top. Note its shape, size, colour, texture, and whether it's sticky, dry, scaly or smooth. Colours fade with age and rain."],
  ["Warts or scales", "Patches left on the cap by a veil that covered the whole young mushroom. Classic on many Amanitas, but rain can wash them off."],
  ["Margin", "The edge of the cap. It can be rolled in, wavy, striated (lined) or have bits of veil hanging from it."],
  ["Gills (lamellae)", "Thin blades under the cap that make the spores. Note how they meet the stem: free (not touching), attached, or decurrent (running down it)."],
  ["Pores", "Tiny holes instead of gills, as in boletes and many shelf fungi. Note their colour and whether they bruise when pressed."],
  ["Teeth and ridges", "Spines (hedgehogs, lion's mane) or blunt, forked ridges (chanterelles) instead of gills."],
  ["Ring (annulus)", "A skirt on the stem, left by a veil that covered the young gills. It can fall off, so look for a mark where it was."],
  ["Stem (stipe)", "Note whether it's central, off-centre or to the side; hollow or solid; and its colour, texture and any bruising."],
  ["Volva", "A cup or sac at the very base, left by the universal veil. It's often buried, which is why you dig the whole mushroom up. A volva is a key warning sign of deadly Amanitas."],
  ["Mycelium", "The thread-like body of the fungus in the soil or wood. The mushroom is only its fruit."],
  ["Spore print", "The colour of the spores, dropped onto paper overnight. One of the most useful features for telling groups apart."]
];
