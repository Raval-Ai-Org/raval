# Sectors: local, trades, health and venues (group B)

Research date: 2026-11-24. Method: web searches (standard mode) over trade, platform
and regulator guidance; page fetches were blocked by the network policy this run, so
each point rests on the search engine's reading of the pages listed under Sources.
Most guides are vendor blogs (field-service software, booking apps, agencies): their
advice is consistent and practical, their statistics are not used here. Everything
below is written in our own words; no brand is named inside the sector entries.

Regulatory findings (Meta, NMC, ADA, RERA, FTC) are folded into each entry's
`regulated` note and the cross-sector lessons.

```json
{
 "id": "plumbing",
 "label": "Plumbing",
 "kind": "service",
 "parent": "local",
 "match": ["plumber", "plumbing", "drain cleaning", "leak repair", "water heater", "geyser", "pipe repair", "blocked drain", "bathroom fitting", "boiler"],
 "show": "A uniformed plumber kneeling under a real sink or at an opened wall, the leak or blocked trap, then the fixed pipework; the branded van outside a home on a real street",
 "proof": ["Own before/after of a real job", "Licence and insurance number", "Response window they commit to", "Written workmanship guarantee", "Verbatim review with permission"],
 "wants": "Someone who turns up today, finds the real cause, fixes it once and leaves the place clean at a price agreed first",
 "doubts": "Surprise bills, no-shows, a cowboy who makes it worse, mess left behind, being upsold a replacement",
 "cliches": ["Cartoon plumber with a plunger", "Toolbox flat-lay", "Smiling stock man with wrench"],
 "angles": ["What we found behind your wall today", "Price agreed before we pick up a tool", "Cold shower? We can be there today", "Small drip now, ceiling stain later"],
 "carousels": ["The call -> what we found -> the cause -> the fix -> how to avoid it -> book", "Five signs your water heater is failing -> each sign -> when to call us"],
 "videoArc": "Water on the floor on arrival -> real plumber traces the leak -> close-up of the failed part -> new fitting tightened -> dry floor reveal -> licence and guarantee card -> call now",
 "typeVoices": ["sturdy-grotesk", "workwear-slab", "multiscript-soft"],
 "moments": ["First cold snap", "Monsoon", "Summer heat", "Christmas", "Eid", "School holidays"],
 "regulated": "Google Local Services needs background, licence and insurance checks; never claim a badge not held"
}
```

```json
{
 "id": "electrical",
 "label": "Electrical",
 "kind": "service",
 "parent": "local",
 "match": ["electrician", "electrical", "rewiring", "panel upgrade", "ev charger", "wiring", "ups installation", "solar inverter", "lighting install", "fuse box"],
 "show": "A licensed electrician at an open distribution board, the burnt or double-tapped breaker found, then a neat labelled board; an EV charger or inverter fitted on a real wall",
 "proof": ["Own before/after of a real board", "Licence or registration number", "Insured, with cover named", "Safety test certificate issued", "Years trading they state"],
 "wants": "Safe wiring done to code, no repeat trips, tidy work, and a clear quote for upgrades like EV, solar or backup power",
 "doubts": "Fire risk from bad work, unlicensed workers, failed inspection, walls torn open, hidden costs",
 "cliches": ["Lightning bolt clip art", "Glowing bulb on dark backdrop", "Hard hat stock thumbs-up"],
 "angles": ["What we found in this panel today", "Load-shedding ready: backup sized to your home", "Tripping again? Here is the usual cause", "Labelled, tested and certified before we leave"],
 "carousels": ["Old board -> hazard -> rebuild -> tested -> labelled -> book an inspection", "EV charger: survey -> cable route -> install -> test -> first charge"],
 "videoArc": "Breaker trips in a dark room -> electrician opens the board -> hazard close-up -> rewire timelapse -> lights on reveal -> licence card -> book a safety check",
 "typeVoices": ["sturdy-grotesk", "workwear-slab"],
 "moments": ["Summer heat", "Monsoon", "First cold snap", "Christmas", "Diwali", "New Year"]
}
```

```json
{
 "id": "hvac",
 "label": "HVAC and AC service",
 "kind": "service",
 "parent": "local",
 "match": ["hvac", "air conditioning", "ac repair", "ac service", "heating", "furnace", "heat pump", "split ac", "duct cleaning", "inverter ac", "chiller"],
 "show": "A technician on a real outdoor unit or with a gauge set on the line, the clogged filter or coil pulled out beside a clean one, the van in a real driveway",
 "proof": ["Real job: problem, cause found, repair done", "Licence and refrigerant certification", "Maintenance plan with stated price", "Response window they commit to", "Verbatim review with permission"],
 "wants": "Cool or warm again fast, a fair diagnosis, lower bills, and reminders before the season so it never fails on the worst day",
 "doubts": "Being sold a new unit when a part would do, gas top-ups that leak out, long waits in peak season",
 "cliches": ["Thermometer cartoon sweating", "Snowflake and flame icons", "Stock family on sofa with remote"],
 "angles": ["Book your pre-summer service before the rush", "On this call our tech found the real cause", "Dirty filter vs clean: see the difference", "Repair first, replace only if it pays"],
 "carousels": ["What a tune-up checks -> filter -> coil -> gas pressure -> drain -> test run -> book", "Service call: symptom -> cause found -> repair -> result -> tip"],
 "videoArc": "Warm air from the vent -> tech pulls a clogged filter -> coil wash close-up -> gauge reading -> cold air on hand reveal -> service plan price card -> book",
 "typeVoices": ["sturdy-grotesk", "workwear-slab", "multiscript-soft"],
 "moments": ["Summer heat", "First cold snap", "Monsoon", "Ramadan iftar", "Christmas", "School holidays"]
}
```

```json
{
 "id": "cleaning",
 "label": "Cleaning services",
 "kind": "service",
 "parent": "local",
 "match": ["cleaning", "house cleaning", "deep cleaning", "maid service", "move out cleaning", "office cleaning", "sofa cleaning", "carpet cleaning", "pressure washing", "janitorial"],
 "show": "The crew in uniform mid-clean in a real home or office; a split frame of the same oven, grout line, sofa or driveway before and after from one angle and light",
 "proof": ["Own before/after from the same angle", "Named crew with consent", "Insured and vetted staff, as they state", "Satisfaction re-clean promise", "Verbatim review with permission"],
 "wants": "A spotless home without the effort, the same trusted people each time, clear pricing by room or hour, easy booking",
 "doubts": "Strangers in the home, things broken or missing, rushed work, harsh chemicals near kids and pets",
 "cliches": ["Sparkle emoji over a sink", "Model in apron with spray bottle", "Rubber gloves flat-lay"],
 "angles": ["One oven, three hours: this is what we do", "Moving out? Get your deposit-ready clean", "Same team every visit, by name", "Priced by room before we arrive"],
 "carousels": ["Before -> during -> after for one room -> what was used -> book", "Move-out checklist -> kitchen -> bath -> floors -> walls -> book a deep clean"],
 "videoArc": "Grimy grout or oven door close-up -> crew member starts scrubbing -> satisfying wipe pass -> same-angle after reveal -> price-by-room card -> book",
 "typeVoices": ["rounded-friendly", "sturdy-grotesk", "multiscript-soft"],
 "moments": ["Spring cleaning", "Eid", "Diwali", "Christmas", "New Year", "School holidays"]
}
```

```json
{
 "id": "pest-control",
 "label": "Pest control",
 "kind": "service",
 "parent": "local",
 "match": ["pest control", "exterminator", "termite", "fumigation", "bed bugs", "cockroach", "rodent control", "mosquito", "dengue spray", "pest treatment"],
 "show": "A technician in protective kit inspecting a real skirting board or roof void with a torch, the droppings or termite trail found, sealed entry point and bait station after",
 "proof": ["Licence or registration for chemicals", "Real inspection finding from a job", "Written treatment warranty period", "Safety notes for kids and pets", "Verbatim review with permission"],
 "wants": "Pests gone and kept out, safe treatment for family and pets, discreet service, a warranty if they come back",
 "doubts": "Toxic fumes, having to leave home, pests returning a week later, unmarked vans and untrained sprayers",
 "cliches": ["Giant cartoon cockroach", "Skull and crossbones", "Stock man spraying fog cloud"],
 "angles": ["What our inspection found under this sink", "Monsoon brings termites: check before damage", "Safe for kids and pets: how we treat", "Back within the warranty? We return free"],
 "carousels": ["Signs of termites -> mud tubes -> hollow wood -> wings -> book inspection", "Our visit: inspect -> treat -> seal -> follow-up -> warranty"],
 "videoArc": "Torch sweeps a dark corner -> technician finds the trail -> entry point sealed -> bait station placed -> clean kitchen reveal -> warranty card -> book an inspection",
 "typeVoices": ["sturdy-grotesk", "workwear-slab"],
 "moments": ["Monsoon", "Summer heat", "Spring", "First cold snap", "Eid", "Diwali"],
 "regulated": "Chemical claims (safe, organic, kills 100%) need the label's support; use the licence the firm holds"
}
```

```json
{
 "id": "roofing-construction",
 "label": "Roofing and construction",
 "kind": "service",
 "parent": "local",
 "match": ["roofing", "roofer", "construction", "contractor", "renovation", "builder", "waterproofing", "extension", "gray structure", "civil works", "home builder"],
 "show": "The crew on a real roof or slab, drone view of the finished roof on its street, same-angle before/after, materials on site, a progress board",
 "proof": ["Own before/after and drone shots of jobs", "Licence and insurance number", "Written workmanship warranty", "Manufacturer certification they hold", "Years trading and jobs they state"],
 "wants": "A sound roof or build on time and budget, honest scope, clean site, warranty they can call on",
 "doubts": "Storm chasers, half-finished work, cost overruns, leaks after the first rain, no paperwork",
 "cliches": ["Generic shingle close-up", "Hard hat on blueprint", "Handshake in front of a house"],
 "angles": ["Same street, same angle: before and after", "What we found under the old roof", "Waterproofed before the monsoon, not after", "Day by day: watch this extension go up"],
 "carousels": ["Inspection -> damage found -> tear-off -> new layers -> drone finish -> warranty", "Build week by week: footing -> walls -> roof slab -> finishing"],
 "videoArc": "Leak stain on a ceiling -> drone rises over damaged roof -> crew tearing off and laying -> drone pull-back on finished roof -> warranty and licence card -> free inspection",
 "typeVoices": ["sturdy-grotesk", "workwear-slab"],
 "moments": ["Monsoon", "After a storm", "Spring", "First cold snap", "Summer heat"],
 "regulated": "Get the owner's consent before showing an identifiable home or address"
}
```

```json
{
 "id": "interior-design",
 "label": "Interior design",
 "kind": "service",
 "parent": "professional",
 "match": ["interior design", "interior designer", "home styling", "fit-out", "kitchen design", "space planning", "renovation design", "decor", "turnkey interiors"],
 "show": "A finished real room shot wide in daylight, the same room before, material swatches on the client's actual table, the designer on site with a tape measure",
 "proof": ["Own completed projects with client consent", "Process photos from real site visits", "Named designer and their training", "Verbatim client words with permission", "Budget band of a real project"],
 "wants": "A home that feels like them, works for daily life, done within budget and without managing ten trades themselves",
 "doubts": "Blown budgets, a look that is the designer's not theirs, delays from suppliers, renders that never match reality",
 "cliches": ["Unbuilt render shown as real", "Pinterest sofa flat-lay", "Designer holding swatch at camera"],
 "angles": ["This room before we moved one wall", "From mood board to the real room", "Designed around how this family lives", "Where the budget went, line by line"],
 "carousels": ["Before -> brief -> mood board -> materials -> site -> reveal", "One room, three details that changed it -> detail -> detail -> detail -> enquire"],
 "videoArc": "Empty dated room -> designer sketches on site -> swatches laid out -> trades at work quick cuts -> slow walk-through of finished room -> enquire CTA",
 "typeVoices": ["studio-pair", "editorial-serif", "garamond-calm"],
 "moments": ["New Year", "Eid", "Diwali", "Wedding season", "Spring", "Christmas"],
 "regulated": "Label renders as concepts; never show a render as a finished project"
}
```

```json
{
 "id": "moving-courier",
 "label": "Moving and courier",
 "kind": "service",
 "parent": "local",
 "match": ["movers", "moving company", "packers and movers", "relocation", "courier", "delivery service", "house shifting", "storage", "same day delivery", "logistics"],
 "show": "The crew wrapping a real sofa and loading a branded truck neatly, labelled boxes, a rider handing a parcel at a real door, a route pin on the served area",
 "proof": ["Real crew packing and loading footage", "Goods-in-transit insurance they hold", "Fixed quote policy in writing", "Tracking or proof of delivery shown", "Verbatim review with permission"],
 "wants": "Everything arriving intact and on time, a fixed price, careful handlers, and for courier, same-day pickup and tracking",
 "doubts": "Broken furniture, hidden charges on the day, late crews, lost parcels, no one answering the phone",
 "cliches": ["Cartoon box with legs", "Stock couple laughing among boxes", "Globe with arrows"],
 "angles": ["How we wrap a sofa so it arrives perfect", "Fixed quote, no surprises on moving day", "Serving <area>: same-day pickup", "Label these three boxes first"],
 "carousels": ["Moving day: survey -> pack -> wrap -> load -> unload -> set up", "Pack a kitchen: plates -> glasses -> pans -> label -> done"],
 "videoArc": "Packed room on arrival -> crew wraps furniture -> truck loading timelapse -> unload into new home -> owner unpacks intact item -> fixed quote card -> get a quote",
 "typeVoices": ["sturdy-grotesk", "rounded-friendly", "multiscript-soft"],
 "moments": ["School holidays", "Summer", "New Year", "Eid", "Christmas", "Month end"]
}
```

```json
{
 "id": "auto-repair-detailing",
 "label": "Auto repair and detailing",
 "kind": "service",
 "parent": "automotive",
 "match": ["auto repair", "mechanic", "car service", "garage", "detailing", "car wash", "ceramic coating", "ppf", "paint correction", "tuning", "workshop"],
 "show": "The car on a real lift or in the bay, a polisher clearing swirl marks on one panel, the worn part beside the new one, the clean organised workshop",
 "proof": ["Own before/after in matched light", "Old part shown to the owner", "Certified technicians they name", "Written warranty on parts and labour", "Verbatim review with permission"],
 "wants": "An honest diagnosis, a fair price agreed first, the car back on time, and for detailing a visible finish that lasts",
 "doubts": "Being ripped off, work not done, cheap parts, scratches from a careless wash, the car held for days",
 "cliches": ["Wrench and gear clip art", "Model posing on the bonnet", "Sunlit after vs shaded before"],
 "angles": ["This panel half corrected: see the line", "The worn part we replaced, shown to you", "Price agreed before we touch the car", "Monsoon check: tyres, wipers, brakes"],
 "carousels": ["Arrival -> wash -> decontaminate -> correct -> coat -> handover", "Service visit: symptom -> diagnosis -> part -> fix -> road test"],
 "videoArc": "Dull swirled bonnet under light -> polisher pass with tape line -> 50/50 reveal -> beading water on coating -> price and warranty card -> book a slot",
 "typeVoices": ["workwear-slab", "heritage-slab", "condensed-punch"],
 "moments": ["Monsoon", "Summer heat", "Eid", "Wedding season", "First cold snap", "New Year"]
}
```

```json
{
 "id": "salon-barber",
 "label": "Salon and barber",
 "kind": "service",
 "parent": "beauty",
 "match": ["salon", "barber", "barbershop", "haircut", "hair colour", "bridal makeup", "beauty parlour", "fade", "keratin", "nails", "hair studio"],
 "show": "The stylist or barber at the chair mid-cut, a real client's finished cut from three angles with consent, the price menu card with real prices, the shop interior",
 "proof": ["Real client work with written consent", "Named stylist and their speciality", "Price menu with real prices", "Verbatim review with permission", "Years open they state"],
 "wants": "A cut or colour that suits them, a stylist who listens, on-time appointments, clear prices, a clean chair",
 "doubts": "A bad cut, colour gone wrong, being upsold treatments, waiting despite booking, hygiene",
 "cliches": ["Scissors and comb icon", "Stock model hair flip", "Mirror selfie with other clients shown"],
 "angles": ["Three angles of today's fade", "Our menu, real prices, no surprises", "Meet the stylist behind this colour", "Eid slots are open: book your chair"],
 "carousels": ["Front -> side -> back -> the products -> stylist -> book", "Price menu: cuts -> colour -> treatments -> bridal -> book"],
 "videoArc": "Client sits, before look -> clippers and scissors close-ups -> blow-dry and finish -> slow turn reveal with consent -> price card -> book now",
 "typeVoices": ["heritage-slab", "deco-elegant", "multiscript-soft"],
 "moments": ["Eid", "Wedding season", "Diwali", "Christmas", "New Year", "Valentine's"],
 "regulated": "Written consent for client photos, covering ads; check mirrors for other clients"
}
```

```json
{
 "id": "spa-wellness",
 "label": "Spa and wellness",
 "kind": "venue",
 "parent": "beauty",
 "match": ["spa", "massage", "day spa", "wellness centre", "hammam", "facial", "body treatment", "aromatherapy", "relaxation", "couples massage"],
 "show": "The real treatment room in soft light, a therapist preparing oils and towels, hands at work on a back with consent, the relaxation lounge, a package card with prices",
 "proof": ["Real rooms and facilities photographed", "Named, trained therapists", "Package and membership prices", "Hygiene routine shown", "Verbatim review with permission"],
 "wants": "Real rest in a clean, calm place, skilled hands, privacy, and a clear package they can gift or book",
 "doubts": "Unhygienic rooms, untrained staff, pushy upsells, privacy, a place that looks nothing like the photos",
 "cliches": ["Stacked stones and orchid", "Cucumber eyes stock model", "Candle bokeh with no room"],
 "angles": ["The room you will rest in, as it is", "Meet the therapist behind your massage", "A gift card they will actually use", "Ninety minutes, three steps: what happens"],
 "carousels": ["Arrival -> robe -> treatment room -> lounge -> tea -> book", "Packages: single -> couples -> monthly -> gift card -> book"],
 "videoArc": "Door opens on the calm room -> therapist warms oils -> towels and hands close-ups -> lounge with tea -> package price card -> book",
 "typeVoices": ["deco-elegant", "quiet-minimal", "luxe-kufi"],
 "moments": ["Valentine's", "Mother's Day", "Eid", "Christmas", "New Year", "Wedding season"],
 "regulated": "No health cure claims; Meta bars copy implying a viewer's body or health traits"
}
```

```json
{
 "id": "clinic-doctor",
 "label": "Clinic and doctor",
 "kind": "service",
 "parent": "healthcare",
 "match": ["clinic", "doctor", "medical centre", "gp", "polyclinic", "family physician", "pediatrician", "dermatologist", "lab tests", "consultation"],
 "show": "The real clinic reception and consult room, the doctor named with qualifications, a health-tip card in plain words, opening hours and a location pin",
 "proof": ["Doctor's name, degree and registration", "Real clinic photos", "Services and fees listed", "Opening hours and wait policy", "Health education in plain words"],
 "wants": "A qualified doctor who listens, short waits, clear fees, and simple advice they can trust for the family",
 "doubts": "Long waits, unqualified staff, unnecessary tests, hidden fees, privacy of their records",
 "cliches": ["Stethoscope on blue gradient", "Stock doctor arms crossed", "Heartbeat line icon"],
 "angles": ["Meet the doctor: qualifications and focus", "When a fever needs a doctor: three signs", "Fees listed before you sit down", "Open late on weekdays in <area>"],
 "carousels": ["Health tip: symptom -> what it may mean -> home care -> when to see us", "Your visit: book -> reception -> consult -> tests -> follow-up"],
 "videoArc": "Common question on screen -> doctor answers to camera in clinic -> one plain tip -> clinic room and hours -> book an appointment",
 "typeVoices": ["humanist-care", "classic-trust", "multiscript-soft"],
 "moments": ["Monsoon", "Flu season", "Ramadan", "Summer heat", "School holidays", "World Health Day"],
 "regulated": "India NMC: no testimonials, before/after or best-doctor claims; follow local medical council ad rules"
}
```

```json
{
 "id": "dental",
 "label": "Dental clinic",
 "kind": "service",
 "parent": "healthcare",
 "match": ["dentist", "dental clinic", "teeth whitening", "braces", "aligners", "root canal", "implants", "orthodontist", "smile design", "dental care"],
 "show": "The dentist and nurse in the real surgery, the clean equipment and steriliser, a calm patient in the chair with consent, a treatment price list, a brushing tip",
 "proof": ["Dentist name and registration", "Sterilisation routine shown", "Treatment price list", "Patient case with signed release", "Equipment they really use"],
 "wants": "Painless care, a dentist who explains, a clean clinic, upfront costs, a smile they feel good about",
 "doubts": "Pain, needles, cost surprises, unneeded treatment, hygiene, a result that looks fake",
 "cliches": ["Cartoon tooth with sparkle", "Stock model perfect smile", "Floating tooth 3D render"],
 "angles": ["What a root canal really involves, step by step", "How we sterilise every instrument", "Prices for common treatments, listed", "Nervous? This is how we keep it painless"],
 "carousels": ["Treatment explained: problem -> options -> steps -> aftercare -> book", "Clinic tour: reception -> surgery -> steriliser -> team -> book"],
 "videoArc": "Patient question on screen -> dentist explains at the chair -> instrument tray and steriliser -> calm patient leaving with consent -> price card -> book a check-up",
 "typeVoices": ["humanist-care", "classic-trust"],
 "moments": ["New Year", "Wedding season", "Eid", "School holidays", "World Oral Health Day", "Valentine's"],
 "regulated": "Signed written release for any patient photo; Meta cosmetic ads 18+; India NMC bars before/after"
}
```

```json
{
 "id": "physio-therapy",
 "label": "Physiotherapy",
 "kind": "service",
 "parent": "healthcare",
 "match": ["physiotherapy", "physio", "physical therapy", "rehab", "sports injury", "back pain", "chiropractic", "posture", "mobility", "recovery"],
 "show": "The physio guiding a real patient through an exercise in the clinic gym, hands-on assessment with consent, a short exercise demo by the therapist, equipment in use",
 "proof": ["Therapist name and registration", "Exercise demos by own staff", "Patient story with documented consent", "Session price and length", "Real clinic and equipment"],
 "wants": "Less pain, moving freely again, a plan they understand, exercises they can do at home",
 "doubts": "Treatment that does nothing, endless sessions, pain during therapy, cost adding up",
 "cliches": ["Skeleton spine glowing red", "Stock runner holding knee", "Massage oil flat-lay"],
 "angles": ["Desk back pain: one stretch our physio uses", "Your first visit: what we assess", "Back to running: a plan in stages", "Session price and length, upfront"],
 "carousels": ["Exercise: why -> how -> mistakes -> reps -> when to stop", "First visit: history -> assessment -> plan -> home exercises -> review"],
 "videoArc": "Patient wincing at a movement -> physio assesses -> therapist demos one exercise -> patient does it with guidance -> plan card -> book an assessment",
 "typeVoices": ["humanist-care", "quiet-minimal"],
 "moments": ["New Year", "Marathon season", "School sports term", "Ramadan", "World Physiotherapy Day"],
 "regulated": "Consent for patient content; no promise of cure or guaranteed recovery time"
}
```

```json
{
 "id": "mental-health",
 "label": "Mental health and therapy",
 "kind": "service",
 "parent": "healthcare",
 "match": ["therapist", "counselling", "psychologist", "therapy", "mental health", "anxiety", "couples therapy", "online therapy", "psychotherapy", "wellbeing"],
 "show": "The therapist's real quiet room, the therapist named on camera explaining one idea, a plain-words card on what a first session is like, fees and booking",
 "proof": ["Therapist name, licence and training", "What a first session involves", "Fees and session length", "Confidentiality policy stated", "Approaches they are trained in"],
 "wants": "To feel understood, a qualified person they can trust, privacy, and a clear first step without commitment",
 "doubts": "Stigma, being judged, confidentiality, cost, not clicking with the therapist, not knowing what to say",
 "cliches": ["Brain with storm cloud", "Person head in hands stock", "Puzzle piece head"],
 "angles": ["What happens in a first session", "You do not need a crisis to start", "Meet the therapist: how I work", "Fees, length and privacy, in plain words"],
 "carousels": ["First session: book -> arrive -> talk -> plan -> next step", "Myth vs fact about therapy -> myth -> fact -> myth -> fact -> reach out"],
 "videoArc": "Common worry on screen -> therapist speaks warmly to camera -> the room -> one plain idea -> fees and privacy card -> book a first chat",
 "typeVoices": ["humanist-care", "quiet-minimal"],
 "moments": ["World Mental Health Day", "New Year", "Exam season", "Ramadan", "Mental Health Awareness Month"],
 "regulated": "No client testimonials (APA/NASW limits); never imply the viewer has a condition (Meta)"
}
```

```json
{
 "id": "gym-fitness-studio",
 "label": "Gym and fitness studio",
 "kind": "venue",
 "parent": "fitness",
 "match": ["gym", "fitness studio", "personal training", "crossfit", "bootcamp", "strength training", "hiit", "boxing gym", "ladies gym", "functional training"],
 "show": "Real members mid-class with consent, a named coach cueing a lift, the actual floor and kit, a schedule card and a free trial or intro price",
 "proof": ["Real class footage with consent", "Named coaches and certifications", "Membership prices and trial offer", "Class schedule as it runs", "Member quote with permission"],
 "wants": "A place they will keep going to, coaches who care, a welcoming crowd, results they can feel, a clear price",
 "doubts": "Feeling judged, intimidating regulars, contracts they cannot leave, crowded kit, not knowing where to start",
 "cliches": ["Oiled model flexing", "Dumbbell flat-lay", "Weight-loss side-by-side"],
 "angles": ["Your first class: what happens", "Meet the coach who will train you", "Try a week before you commit", "Women-only hours, every weekday morning"],
 "carousels": ["First visit: welcome -> warm-up -> class -> cool-down -> trial", "Coach spotlight: who -> how they coach -> one tip -> their classes"],
 "videoArc": "Members warming up -> mid-class effort -> coach cue close-up -> high-fives after -> schedule and trial card -> DM to book a trial",
 "typeVoices": ["condensed-punch", "arena-condensed", "bold-geo"],
 "moments": ["New Year", "Summer", "Ramadan", "After Eid", "Back to school", "Wedding season"],
 "regulated": "No weight-loss before/after (Meta); FTC: show typical results, not one outlier"
}
```

```json
{
 "id": "yoga-pilates",
 "label": "Yoga and Pilates studio",
 "kind": "venue",
 "parent": "fitness",
 "match": ["yoga", "pilates", "reformer", "yoga studio", "meditation", "vinyasa", "hot yoga", "barre", "breathwork", "prenatal yoga"],
 "show": "The real studio in daylight, a named teacher adjusting a student with consent, reformers lined up, the week's timetable, an intro pack price",
 "proof": ["Named teachers and training hours", "Real class photos with consent", "Timetable as it runs", "Intro pack and class prices", "Student words with permission"],
 "wants": "A calm place, a teacher who keeps them safe, classes for their level, flexibility and less stress",
 "doubts": "Not flexible enough, everyone else advanced, injury, cliquey vibe, expensive drop-ins",
 "cliches": ["Silhouette at sunset", "Lotus clip art", "Model in impossible pose"],
 "angles": ["Never done reformer? Start here", "This week's timetable", "Meet your teacher", "Beginner-friendly: what to expect"],
 "carousels": ["New student: arrive -> mat -> class -> rest -> intro pack", "Timetable: morning -> lunch -> evening -> weekend -> book"],
 "videoArc": "Quiet studio at dawn -> teacher sets the mat -> class flow cuts -> gentle adjustment -> savasana stillness -> intro pack card -> book",
 "typeVoices": ["quiet-minimal", "garamond-calm"],
 "moments": ["New Year", "International Yoga Day", "Spring", "Ramadan", "Summer", "Mother's Day"]
}
```

```json
{
 "id": "wedding-events",
 "label": "Weddings and events",
 "kind": "service",
 "parent": "hospitality",
 "match": ["wedding planner", "event planner", "wedding venue", "banquet hall", "marquee", "decor", "mehndi", "barat", "walima", "event management", "catering events"],
 "show": "A real wedding the team ran, credited to the photographer with the couple's consent, the stage and decor being built, the empty venue dressed, a package card",
 "proof": ["Real weddings with couple consent", "Photographer credited on every image", "Packages with real prices", "Venue capacity and dates open", "Couple's words with permission"],
 "wants": "A day that runs itself, the look they dreamed of, no family stress, an honest budget and a team that shows up",
 "doubts": "Decor not matching the photos, delays on the day, hidden extras, vendors no-showing, overcrowding",
 "cliches": ["Rings on a bible flat-lay", "Stock couple at sunset", "Uncredited Pinterest decor"],
 "angles": ["Setup to reveal: how this stage came together", "Capacity, dates and packages for this season", "The couple's day, in their words", "Your mehndi, barat and walima, one team"],
 "carousels": ["Brief -> mood -> setup -> reveal -> details -> enquire", "Packages: venue -> decor -> catering -> extras -> dates open"],
 "videoArc": "Empty hall -> crew builds stage timelapse -> flowers and lights close-ups -> doors open on finished set -> credited real moment -> dates and package card -> enquire",
 "typeVoices": ["deco-elegant", "garamond-calm", "festive-pop"],
 "moments": ["Wedding season", "Eid", "Diwali", "Valentine's", "New Year", "Christmas"],
 "regulated": "Photographer owns the copyright: get permission and credit; couple consent before posting"
}
```

```json
{
 "id": "hotel-resort",
 "label": "Hotel and resort",
 "kind": "venue",
 "parent": "hospitality",
 "match": ["hotel", "resort", "boutique hotel", "guest house", "serviced apartments", "villa", "beach resort", "mountain resort", "rooms", "stay", "staycation"],
 "show": "The real room as booked, shot wide with its view, the pool or breakfast as it is served, staff at the front desk, guest posts reshared with permission",
 "proof": ["Real room and facility photos", "Guest posts reshared with permission", "Room rate or package they publish", "Their real rating and review count", "Named staff and services"],
 "wants": "A place that matches the photos, a good night's sleep, a view or experience to remember, fair rates and easy check-in",
 "doubts": "Rooms smaller than shown, hidden fees, noise, dirty bathrooms, location far from what they need",
 "cliches": ["Sunset infinity pool, no hotel", "Stock couple clinking glasses", "Over-edited wide-angle room"],
 "angles": ["The room you book, exactly as it is", "Breakfast, as served this morning", "Weekend package: what is included", "Seen by our guests: your photos"],
 "carousels": ["Room tour: door -> bed -> bath -> view -> rate", "A day here: breakfast -> pool -> spa -> dinner -> book"],
 "videoArc": "Key card opens the door -> walk into the real room -> curtains open on the view -> breakfast and pool cuts -> package price card -> book direct",
 "typeVoices": ["deco-elegant", "luxe-kufi", "editorial-serif"],
 "moments": ["School holidays", "Eid", "Christmas", "New Year", "Valentine's", "Summer"]
}
```

```json
{
 "id": "restaurant",
 "label": "Restaurant",
 "kind": "venue",
 "parent": "restaurant",
 "match": ["restaurant", "dining", "grill", "bbq", "karahi", "biryani", "steakhouse", "family restaurant", "dine in", "takeaway", "buffet"],
 "show": "The real dish close-up in window light, steam and texture, the chef plating it, the dining room full on a real night, the dish's name and price",
 "proof": ["Real dish photos from their kitchen", "Dish name and menu price", "Chef and kitchen team named", "Guest photos reshared with permission", "Opening hours and location pin"],
 "wants": "Food that tastes like it looks, a good night out, fair prices, quick service, a table when they arrive",
 "doubts": "Food not matching the photo, long waits, hygiene, hidden service charges, small portions",
 "cliches": ["Stock burger on slate", "Over-styled glossy plate", "Cartoon chef hat"],
 "angles": ["Tonight's special, plated by our chef", "Iftar platter: what is on it and the price", "From the grill to your table in minutes", "Family deal for four, priced"],
 "carousels": ["Dish -> ingredients -> chef plating -> served -> price", "Menu highlights: starter -> main -> dessert -> drink -> book a table"],
 "videoArc": "Sizzle on the grill -> chef tosses or plates -> slow close-up of the real dish -> table of guests digging in -> dish and price card -> order or book",
 "typeVoices": ["chunky-serif", "festive-pop", "multiscript-soft"],
 "moments": ["Ramadan iftar", "Eid", "Valentine's", "Christmas", "New Year", "Cricket match nights"],
 "regulated": "Show the dish as served; deals must state the real price and terms"
}
```

```json
{
 "id": "cafe",
 "label": "Cafe and coffee shop",
 "kind": "venue",
 "parent": "cafe",
 "match": ["cafe", "coffee shop", "espresso", "specialty coffee", "roastery", "bakery cafe", "brunch", "latte", "tea house", "chai"],
 "show": "A barista's hands pulling a shot or pouring latte art, the real counter and pastries, regulars at the window seat with permission, the drink with its price",
 "proof": ["Real drinks and bakes from their counter", "Named baristas and roaster", "Regulars featured with permission", "Menu prices", "Opening hours and location pin"],
 "wants": "A good cup, a place to sit and work or meet, friendly staff who know their order, fresh bakes",
 "doubts": "Burnt or bland coffee, no seats or wifi, overpriced, stale pastries, slow queues",
 "cliches": ["Latte art and nothing else", "Coffee beans heart shape", "Laptop and cup flat-lay"],
 "angles": ["New on the menu this week", "Meet the barista behind your morning cup", "Fresh from the oven at 8 am", "Seats, sockets and good wifi"],
 "carousels": ["Bean -> grind -> pull -> pour -> cup -> come in", "Menu: coffee -> tea -> bakes -> brunch -> hours"],
 "videoArc": "Morning shutters open -> grinder and shot pull -> latte art pour -> pastry tray out of the oven -> regular takes the cup -> menu price card -> visit us",
 "typeVoices": ["warm-serif", "personal-note", "rounded-friendly"],
 "moments": ["First cold snap", "Ramadan iftar", "Exam season", "Valentine's", "Christmas", "International Coffee Day"]
}
```

```json
{
 "id": "travel-agency",
 "label": "Travel agency",
 "kind": "service",
 "parent": "travel",
 "match": ["travel agency", "tour operator", "holiday packages", "umrah packages", "hajj", "visa services", "tours", "air tickets", "honeymoon packages", "group tours"],
 "show": "Real photos from trips they ran, the guide or agent with a group with consent, a day-by-day itinerary card, the package price per person and what is included",
 "proof": ["Photos from trips they really ran", "Licence or association membership", "Price per person with inclusions", "Itinerary day by day", "Traveller words with permission"],
 "wants": "A trip that runs smoothly, honest prices with everything included, help with visas, someone to call if things go wrong",
 "doubts": "Hidden costs, hotels not as promised, visa refusals, cancellations, agents who vanish after payment",
 "cliches": ["Plane over globe", "Stock beach with no trip", "Passport and sunglasses flat-lay"],
 "angles": ["Seven days, day by day, price per person", "What is included and what is not", "Umrah package: hotel distance stated", "From our last group trip"],
 "carousels": ["Day 1 -> day 2 -> day 3 -> day 4 -> inclusions -> price", "Visa steps: documents -> appointment -> wait -> collect -> fly"],
 "videoArc": "Departure gate with the group -> arrival and hotel walk-in -> highlight stops quick cuts -> group photo with consent -> itinerary and price card -> enquire",
 "typeVoices": ["bold-geo", "multiscript-soft", "editorial-serif"],
 "moments": ["School holidays", "Ramadan", "Hajj season", "Eid", "Christmas", "New Year"],
 "regulated": "State the total price and inclusions; licence rules for Hajj and Umrah operators apply"
}
```

```json
{
 "id": "real-estate-agent",
 "label": "Real estate agent",
 "kind": "service",
 "parent": "real-estate",
 "match": ["real estate agent", "realtor", "property dealer", "estate agent", "homes for sale", "rentals", "property consultant", "brokerage", "listings", "buy sell rent"],
 "show": "The real listing's best room and exterior, a spec strip (beds, baths, size, price), the agent on a walk-through, a sold story with days on market",
 "proof": ["Real listing photos and specs", "Sold stories with client permission", "Licence or registration number", "Area they cover, named", "Client words with permission"],
 "wants": "The right home at a fair price, an agent who knows the area, honest advice, and a smooth deal",
 "doubts": "Fake or sold-out listings, pressure, hidden commission, misleading photos, paperwork problems",
 "cliches": ["Key in hand stock", "Handshake over contract", "Sold sign graphic only"],
 "angles": ["Just listed: the room that sells it", "Sold in <area>: how it went", "3 bed, 2 bath, the real price", "What your budget buys in <area> now"],
 "carousels": ["Exterior -> living -> kitchen -> bedroom -> spec strip -> book a viewing", "Sold story: brief -> pricing -> viewings -> offers -> keys"],
 "videoArc": "Front door POV -> walk-through of real rooms -> best feature close-up -> agent to camera with one fact -> spec strip and price -> book a viewing",
 "typeVoices": ["garamond-calm", "classic-trust", "swiss-grotesk"],
 "moments": ["Spring", "New Year", "School holidays", "Eid", "Year end"],
 "regulated": "Credit the listing brokerage if not yours; show licence or RERA numbers where required"
}
```

```json
{
 "id": "real-estate-developer",
 "label": "Real estate developer",
 "kind": "hybrid",
 "parent": "real-estate",
 "match": ["developer", "housing society", "residential project", "apartments", "off plan", "launch", "towers", "gated community", "plots", "installment plan", "possession"],
 "show": "Dated site progress photos and drone shots, the real show apartment, a labelled concept render, the location pin with travel times, a payment plan card",
 "proof": ["Dated construction progress photos", "Registration or RERA number shown", "Approvals they hold, named", "Delivered past projects", "Payment plan with real figures"],
 "wants": "A home or investment that gets built on time, approvals in place, a fair payment plan and a good location",
 "doubts": "Delays, unapproved land, renders that never match reality, price hikes, possession that never comes",
 "cliches": ["Render passed off as built", "Golden key with skyline", "Stock family on balcony"],
 "angles": ["Site update: this month's progress", "Show apartment, as it stands today", "Payment plan, figure by figure", "Ten minutes to <landmark>: the real drive"],
 "carousels": ["Month -> foundation -> structure -> facade -> handover date", "Plan: booking -> installments -> possession -> registration number"],
 "videoArc": "Drone rises over the real site -> cranes and crew at work -> show apartment walk-through -> labelled render of the finish -> registration and plan card -> book a site visit",
 "typeVoices": ["garamond-calm", "luxe-kufi", "swiss-grotesk"],
 "moments": ["New Year", "Eid", "Diwali", "Property expo season", "Year end"],
 "regulated": "India RERA: registration number on every post, no ads before registration, no false progress photos"
}
```

```json
{
 "id": "coworking-space",
 "label": "Coworking space",
 "kind": "venue",
 "parent": "real-estate",
 "match": ["coworking", "shared office", "hot desk", "private office", "meeting rooms", "flexible workspace", "business centre", "virtual office", "workspace"],
 "show": "Real members at their desks with consent, the actual meeting room set up, the kitchen and phone booths, an event night in progress, desk and office prices",
 "proof": ["Real space photos and tour", "Member spotlights with consent", "Desk and office prices", "Amenities really included", "Events they really run"],
 "wants": "A productive, reliable place with good internet, people to meet, flexible terms and no hidden extras",
 "doubts": "Noisy space, slow wifi, no free meeting rooms, lock-in contracts, extras on the bill",
 "cliches": ["Stock team high-five", "Laptop on empty white desk", "Neon 'hustle' sign"],
 "angles": ["Meet a member: what they build here", "Desk, office or meeting room: prices", "A day here, as it really runs", "This week's event: who is speaking"],
 "carousels": ["Tour: entrance -> desks -> booths -> meeting room -> kitchen -> prices", "Member spotlight: who -> what -> why here -> one tip"],
 "videoArc": "Morning doors open -> members settle in -> booth call and meeting room cuts -> evening event buzz -> price card -> book a tour",
 "typeVoices": ["quiet-minimal", "swiss-grotesk", "geometric-tech"],
 "moments": ["New Year", "Back to work after Eid", "Startup week", "Summer", "Year end"]
}
```

```json
{
 "id": "car-rental",
 "label": "Car rental",
 "kind": "service",
 "parent": "automotive",
 "match": ["car rental", "rent a car", "car hire", "self drive", "with driver", "chauffeur", "airport pickup", "monthly rental", "luxury car rental", "van hire"],
 "show": "The real cars in the fleet, clean at the depot, being detailed, a renter receiving keys with consent, a rate card per day and what is included",
 "proof": ["Real fleet photos with plates hidden", "Rate per day with inclusions", "Insurance and deposit terms", "Renter photos with permission", "Years operating they state"],
 "wants": "A clean, reliable car at the agreed price, easy pickup, clear insurance, and a driver if needed",
 "doubts": "Hidden fees, deposits withheld, old or dirty cars, breakdowns, damage disputes on return",
 "cliches": ["Stock sports car on empty road", "Car keys flat-lay", "Model leaning on a car"],
 "angles": ["The car you get, as it is today", "Rate per day, everything included, listed", "Airport pickup: we meet you at arrivals", "Wedding car with driver: dates open"],
 "carousels": ["Fleet: economy -> sedan -> SUV -> van -> rates", "Rental steps: book -> documents -> pickup -> drive -> return"],
 "videoArc": "Depot at dawn -> car being washed -> walkaround of the real car -> keys handed over -> rate card -> book",
 "typeVoices": ["workwear-slab", "bold-geo", "condensed-punch"],
 "moments": ["School holidays", "Eid", "Wedding season", "Christmas", "Summer", "New Year"]
}
```

```json
{
 "id": "security-services",
 "label": "Security services",
 "kind": "service",
 "parent": "local",
 "match": ["security services", "security guards", "cctv installation", "alarm systems", "access control", "patrol", "event security", "manned guarding", "bodyguard", "surveillance"],
 "show": "Uniformed guards on a real post or briefing, the patrol vehicle with livery, a CCTV install on a real site, the control room screens, licence and training badges",
 "proof": ["Company licence number", "Guard vetting and training stated", "Insurance and bonding they hold", "Sites and sectors served, with consent", "Response time they commit to"],
 "wants": "Reliable, trained, vetted people or systems that work, fast response, clear reports and a single point of contact",
 "doubts": "Untrained or unvetted guards, no-shows on shift, cameras that fail, false alarms, no accountability",
 "cliches": ["Hooded burglar silhouette", "Padlock on keyboard", "Stock agent in sunglasses"],
 "angles": ["How we vet every guard before day one", "This week's install: cameras and coverage", "Licensed, trained and insured: our numbers", "Free site assessment for your premises"],
 "carousels": ["Guard journey: vetting -> training -> briefing -> post -> reports", "CCTV install: survey -> plan -> install -> test -> handover"],
 "videoArc": "Shift briefing at dawn -> guard takes post -> patrol vehicle rounds -> control room screens -> licence and training card -> book a site assessment",
 "typeVoices": ["sturdy-grotesk", "classic-trust"],
 "moments": ["Eid", "Wedding season", "Christmas", "New Year", "Elections", "Event season"],
 "regulated": "Show only sites a client agreed to; licence rules for guarding firms apply"
}
```

```json
{
 "id": "laundry-tailoring",
 "label": "Laundry and tailoring",
 "kind": "service",
 "parent": "local",
 "match": ["laundry", "dry cleaning", "wash and fold", "ironing", "tailor", "alterations", "stitching", "pickup and delivery", "suit tailoring", "darzi"],
 "show": "The real counter and pressing station, a tailor marking a hem with chalk, a garment before and after alteration on the same hanger, the pickup rider and bag",
 "proof": ["Own before/after of a real garment", "Price list per item or per kg", "Turnaround time they commit to", "Pickup days and areas served", "Verbatim review with permission"],
 "wants": "Clothes back clean, pressed and on time, perfect fit, careful handling of good garments, free or cheap pickup",
 "doubts": "Damaged or lost garments, shrinkage, late delivery before an event, uneven stitching",
 "cliches": ["Stock washing machine row", "Folded towel flat-lay", "Sewing needle clip art"],
 "angles": ["Taken in at the waist: before and after", "Eid stitching: last booking date", "Pickup Tuesday, back Thursday", "Price per item, listed"],
 "carousels": ["Fitting -> chalk marks -> stitching -> press -> final fit", "Prices: shirts -> suits -> dresses -> curtains -> pickup days"],
 "videoArc": "Loose garment on arrival -> tailor pins and chalks -> machine stitching close-up -> steam press -> perfect fit reveal -> price and turnaround card -> book pickup",
 "typeVoices": ["personal-note", "multiscript-soft", "heritage-slab"],
 "moments": ["Eid", "Wedding season", "Diwali", "School term start", "Christmas", "Winter clothes season"]
}
```

## Cross-sector lessons for local and trade services

- **The job is the picture.** For trades the strongest frame is the real worker at the
  real problem, then the fixed result from the same angle. A symbolic object (a key, a
  wrench, a lightning bolt) is what makes the post look like stock; refuse it.
- **"Problem found -> cause -> fix" is the native caption.** HVAC and electrical guides
  both build posts around what the technician found on this call; it doubles as
  education and proof. Studio should ask for, or read, the real finding rather than
  invent one, and leave the slot as a placeholder if none is given.
- **Before/after is honest only when matched.** Same angle, same light, same object.
  Detailing guides warn that sunny-after vs shaded-before reads as a trick. For bodies,
  faces, teeth and health it is restricted or banned; switch to process and explanation.
- **Prices are proof for local services.** A menu card with real prices (salon, laundry,
  spa, cleaning by room, car rental per day, travel per person) removes the biggest
  doubt. Never fill a price the business did not give.
- **Place is part of the message.** "Serving <area>", a map pin, opening hours and a
  response window matter more to a local buyer than a slogan. Use the business's own
  service area words.
- **People with names, by consent.** Named coaches, stylists, therapists, technicians
  and crews build trust; clients and patients appear only with written consent, which
  for salons should cover paid ads and for dental must be a signed release.
- **Health is a different rulebook.** Meta: no copy that implies the viewer's body or
  health traits, no weight-loss side-by-sides, 18+ for cosmetic. India NMC (Oct 2026):
  no testimonials, no before/after, no AI testimonials, no "best doctor". Therapists:
  no client testimonials under most codes. Lead with the clinician, the room, and plain
  education.
- **Property and venues: show what is bought.** The room as booked, the listing with a
  spec strip, the dated site progress. A render must be labelled as a concept; RERA
  makes false progress photos and unregistered promotion actionable in India.
- **Credentials are cheap, credible copy.** Licence and insurance numbers, background
  checks, warranties and certification are what Google's local programme checks; a
  business that has them should say so, and Studio must never draw a badge it lacks.
- **Seasons drive trade demand.** First cold snap and summer heat for HVAC, monsoon for
  roofing, pest and plumbing, Eid and wedding season for salons, tailoring, events and
  car rental, Ramadan for restaurants, iftar and Umrah packages.
- **Video is a 10-15 s job story.** Arrival problem -> real hands at work -> one
  satisfying close-up -> reveal -> proof card -> one CTA. One call to action per post.
- **Reshared customer content needs permission and, for weddings, the photographer's
  credit.** The couple's consent does not cover the photographer's copyright.

## Sources

All were read through search-result summaries on 2026-11-24 (direct page fetches were
blocked by the network policy). Statistics from vendor blogs were not used.

| URL | What it taught | Licence/terms |
| --- | --- | --- |
| https://transparency.meta.com/policies/ad-standards/objectionable-content/personal-health-and-appearance | No ads implying negative self-perception for health/appearance | Meta policy page |
| https://transparency.meta.com/policies/ad-standards/restricted-goods-services/health-wellness | 18+ targeting for cosmetic and weight ads; health ad limits | Meta policy page |
| https://www.auditsocials.com/blog/meta-beauty-cosmetic-ads-before-after-photos-body-image-policy-2026 | 2026 reading of cosmetic before/after rules; weight-loss side-by-sides banned | Publisher terms |
| https://support.google.com/localservices/answer/12174778 | Local Services screening: background, licence, insurance | Google help |
| https://support.google.com/localservices/answer/13017024 | Licence Verified badge for health practices | Google help |
| https://hookagency.com/blog/best-facebook-ads-for-plumbers/ | Service-in-action video and multi-service carousels for plumbers | Publisher terms |
| https://hookagency.com/blog/plumbing-facebook-ads-worth-it/ | Price-anchored first-job offer with same-day booking | Publisher terms |
| https://getjobber.com/academy/plumbing/plumbing-advertising-examples/ | Real repair photo posts; cold-shower humour angle | Publisher terms |
| https://www.getjobber.com/academy/hvac/social-media-for-hvac/ | Maintenance carousel; "found cause -> repair" caption | Publisher terms |
| https://www.housecallpro.com/resources/marketing/hvac-social-media-marketing/ | HVAC content pillars and seasonal reminders | Publisher terms |
| https://getjobber.com/academy/cleaning/cleaning-ads-ideas-and-examples/ | Boosting real posts as cleaning ads; branding consistency | Publisher terms |
| https://getjobber.com/academy/cleaning/how-to-promote-your-cleaning-business/ | Transformations, tips, seasonal checklists | Publisher terms |
| https://www.getjobber.com/academy/roofing/roofing-facebook-ads/ | Drone and crew shots; storm and season timing; consent for property | Publisher terms |
| https://www.jobnimbus.com/blog/turn-job-photos-into-social-media-content-that-gets-real-engagement | Same-angle before/after; rotate real job images | Publisher terms |
| https://www.servicetitan.com/blog/electrician-social-media-marketing | Electrician before/after as accountability | Publisher terms |
| https://www.socialmon.ai/blog/66-electrician-instagram-post-ideas-with-examples-that-win-jobs | Panel, EV and day-in-the-life posts | Publisher terms |
| https://getjobber.com/academy/pest-control/pest-control-ads/ | Trap how-tos, prevention tips | Publisher terms |
| https://www.scorpion.co/home-services/articles/verticals/pest-control/7-social-media-tips-for-pest-control-companies/ | Geotargeted local ads; local SEO tie-in | Publisher terms |
| https://biz.booksy.com/blog/instagram-for-spas-salons-and-barbershops-the-set-up-guide | Client consent before before/after posts | Publisher terms |
| https://resources.rework.com/libraries/beauty-center-growth/before-after-content-marketing | Written consent covering paid ads, revocable | Publisher terms |
| https://socialk.it/en/blog/social-media-for-salons-and-spas | Other clients reflected in salon mirrors | Publisher terms |
| https://www.vagaro.com/learn/wellness/social-media-ideas-for-spas | Therapist day-in-the-life; booking CTA every post | Publisher terms |
| https://squareup.com/us/en/the-bottom-line/reaching-customers/spa-promotion-ideas-boost-bookings | Spa promotions, referrals | Publisher terms |
| https://www.ada.org/resources/practice/practice-management/social-media-policies-for-dentists | Signed written release for patient photos, names, radiographs | ADA terms |
| https://aacd.com/social-media-hipaa | HIPAA risk of unauthorised patient photos | AACD terms |
| https://thesouthfirst.com/health/doctors-on-instagram-nmc-says-no-to-patient-testimonials-paid-ads-ai-promotions-and-guaranteed-claims/ | NMC 2026: no testimonials, AI promos, guaranteed claims | Publisher terms |
| https://www.policyedge.in/p/nmc-restricts-misleading-medical-ads-paid-rankings-and-ai-generated-testimonials | NMC: no before/after even with consent; no rankings | Publisher terms |
| https://www.goodtherapy.org/for-professionals/marketing/digital-marketing/article/therapist-s-guide-ethical-social-media-use | APA/NASW limits on soliciting testimonials | Publisher terms |
| https://www.simplepractice.com/blog/ethical-social-media-presence-therapists/ | Education not treatment; boundaries with clients | Publisher terms |
| https://www.webpt.com/blog/5-creative-examples-of-facebook-posts-for-physical-therapy-clinics | PT post formats | Publisher terms |
| https://www.pteverywhere.com/media/physical-therapy-social-media-ideas | Exercise demos, patient stories with documented consent | Publisher terms |
| https://www.glofox.com/blog/how-to-create-instagram-ads-for-your-fitness-business/ | Class sneak-peek reel; trial offers; one lead path | Publisher terms |
| https://www.pushpress.com/blog/gym-social-media-marketing | Four value posts per promo post | Publisher terms |
| https://www.socialpilot.co/blog/social-media-for-gyms | Posts must give non-members a reason to act | Publisher terms |
| https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255 | FTC endorsement guides: typical results | US government; public domain |
| https://wellhub.com/en-us/blog/increasing-membership/yoga-instagram | Teacher spotlights, location tags | Publisher terms |
| https://www.wellnessliving.com/blog/promote-your-yoga-studio | Schedule clarity, instructor backgrounds | Publisher terms |
| https://pros.weddingpro.com/blog/social-media-image-credit/ | Photographer credit on every image | Publisher terms |
| https://sagnikbhattacharya.com/blog/wedding-venue-instagram-real-weddings-consent-ai | Couple consent log; photographer owns copyright | Publisher terms |
| https://cocoweddingvenues.co.uk/our-members-community/the-images-you-need-to-market-your-wedding-venue/ | Dry shots of the venue; credit rules | Publisher terms |
| https://www.hospitalitynet.org/opinion/4128397/how-user-generated-content-can-help-your-hotel-with-examples | Guest photos as proof; permission for reuse | Publisher terms |
| https://www.sendible.com/insights/social-media-marketing-strategy-for-hotels | Hotel reels and booking-led posts | Publisher terms |
| https://get.chownow.com/blog/instagram-guide-for-restaurants | Close-ups, natural light, captions | Publisher terms |
| https://lounge.untappd.com/how-to-take-mouthwatering-food-instagram-photos-for-your-restaurant/ | Window light, no flash, clean frame | Publisher terms |
| https://bellwethercoffee.com/blog/coffee-shop-marketing-ideas | Cafe behind-the-scenes list | Publisher terms |
| https://joe.coffee/blog/posts/5-tips-marketing-coffee-shop-social/ | Feature regulars with permission | Publisher terms |
| https://insidea.com/blog/marketing/cafe/social-media-marketing-for-cafes | Latte art alone is not identity | Publisher terms |
| https://academy.travefy.com/social-media-marketing-for-travel-agents/ | Travel agent social practice | Publisher terms |
| https://create.vista.com/blog/social-media-marketing-for-travel-businesses/ | Itinerary, dates and prices in tour posts | Publisher terms |
| https://sites.google.com/view/travel-agent-collective/30-social-media-post-prompts-for-travel-advisors | Client-trip throwbacks; wanted vs recommended | Publisher terms |
| https://theclose.com/real-estate-social-media-post-ideas | Listings, sales, open houses as content | Publisher terms |
| https://coffeecontracts.com/blog/just-sold-post-ideas-for-real-estate-agents | Sold case study: days on market, offers, privacy | Publisher terms |
| https://www.housingwire.com/articles/real-estate-social-media-post-ideas/ | Credit the listing brokerage | Publisher terms |
| https://www.mondaq.com/india/real-estate/1728630/unauthorized-promotion-and-promoter-liability-under-rera-coming-soon-is-still-advertising | "Coming soon" is advertising under RERA | Publisher terms |
| https://www.freepressjournal.in/amp/mumbai/mumbai-developers-fined-for-not-disclosing-maharera-number | Registration number required on social ads | Publisher terms |
| https://www.constructionworld.in/latest-construction-news/real-estate-news/misleading-photos-by-up-developers-to-receive-legal-action/25106 | False progress photos actionable | Publisher terms |
| https://www.spacebring.com/blog/tips/coworking-instagram-marketing | Member spotlights, space tours | Publisher terms |
| https://nexudus.com/blog/10-workspaces-doing-great-things-on-social-media | Member stories, events, architecture mix | Publisher terms |
| https://www.autorentalnews.com/articles/how-rental-companies-stay-engaged-on-social-media | Fleet detailing and renter photos | Publisher terms |
| https://www.businessfleet.com/blogposts/7-new-media-marketing-strategies-from-silvercar | Renter photo contests | Publisher terms |
| https://www.tracktik.com/blog/how-to-market-a-security-company/ | Licensing, bonding, insurance up front | Publisher terms |
| https://www.belfrysoftware.com/blog/security-guard-marketing | Real faces, branded uniforms and vehicles | Publisher terms |
| https://cleancloudapp.com/blog/how-to-grow-your-pickup-and-delivery-service | Fixed-day pickup routes, flat fee | Publisher terms |
| https://socialrails.com/blog/tailoring-business-social-media-marketing | Alteration before/after as top tailoring format | Publisher terms |
| https://fluxnote.io/guides/instagram-reels-car-detailing-strategy | Short before/after montages for detailing | Publisher terms |
| https://www.socialync.io/blog/social-media-for-auto-detailing | Matched lighting; shop tours | Publisher terms |
| https://www.socialpilot.co/strategy/social-media-marketing-for-auto-repair-shops | Unstaged workshop photos over stock | Publisher terms |
| https://cedreo.com/blog/instagram-content-ideas-for-interior-designers/ | Before/after with design thinking | Publisher terms |
| https://blog.designfiles.co/instagram-marketing-for-interior-designers/ | Process documentation from site visits | Publisher terms |
| https://www.smartmoving.com/blog/social-media-post-ideas-moving-companies | Crew personality and humour | Publisher terms |
| https://www.webfx.com/blog/home-services/moving-company-social-media-guide | Staff intros, process videos | Publisher terms |
