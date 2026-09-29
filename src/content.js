// All portfolio copy lives here. Edit this file — nothing else needs to change.
// Sign text (number, label, title) and panel text both come from here.

export const site = {
  name: "Aashutosh Rana",
  role: "Full-Stack Developer · AI/ML Engineer",
  // hero statement, shown large in the 3D scene behind the bike (one entry per line)
  statement: ["Built to", "move."],
  // the one line in the hero
  line: "Third-year engineer, full-stack builder — currently obsessed with making software that's genuinely useful, not just demoable.",
  email: "kumaraashutoshrana@gmail.com",
  location: "Hosur, Tamil Nadu",
  links: [
    { label: "GitHub", href: "https://github.com/Aashutosh24" },
    { label: "LinkedIn", href: "https://linkedin.com/in/kumar-aashutosh-rana" },
  ],
};

// The start-line sign the bike stands in front of in the hero.
export const startSign = { number: "00", label: "Full-Stack · AI/ML", title: "Aashutosh Rana" };

// `at` = where on the ride (0 → start of road, 1 → destination) the checkpoint sign stands.
// Panel content: `body`, then any of `stat`, `items` (strings or {name, meta, value, text, status}),
// `groups` ({label, chips}).
export const checkpoints = [
  {
    at: 0.08,
    number: "01",
    label: "Where I learned to ride",
    title: "Education",
    body: "Integrated M.Tech, Software Engineering at VIT-AP University, 2024 – 2029.",
    stat: { value: "9.31", unit: "/ 10 CGPA" },
    items: [
      { name: "Pre-University (Science)", meta: "MVM, Hosur · 2021 – 2023", value: "86.4%" },
      { name: "SSLC", meta: "MVM, Hosur", value: "82.2%" },
    ],
  },
  {
    at: 0.27,
    number: "02",
    label: "First real road",
    title: "Experience",
    body: "Software Development Intern at Kirusa Inc, July – August 2025.",
    items: [
      "Web development, mobile app testing and Android work inside a real product team.",
      "Owned functional testing and UI validation for mobile apps, catching issues before users did.",
      "Picked up React Native and Selenium hands-on, building real test workflows.",
    ],
  },
  {
    at: 0.46,
    number: "03",
    label: "Built along the way",
    title: "Projects",
    body: "Things I built to learn something new, and kept building until they held up.",
    items: [
      {
        name: "PYQ Archive",
        meta: "Node.js · Express · Tesseract OCR",
        text: "Extension and site that find and bulk-download VIT-AP past papers, auto-named by OCR.",
      },
      {
        name: "Offline Voice Agent",
        meta: "FastAPI · offline speech-to-text",
        status: "In progress",
        text: "Turns a merchant's spoken sale into a structured transaction, with no network.",
      },
      {
        name: "FitnessClub",
        meta: "React · Google Sign-In · AI",
        text: "Gym platform for programs, trainers, memberships and payments, with AI on top.",
      },
      {
        name: "FFCS Planner",
        meta: "Timetable logic",
        text: "Pick courses, faculty and slots, and see clashes resolved instantly.",
      },
    ],
  },
  {
    at: 0.65,
    number: "04",
    label: "What I ride with",
    title: "Skills",
    body: "What I reach for, from the first commit to the deploy.",
    groups: [
      { label: "Languages", chips: ["Java", "C++", "Python", "JavaScript"] },
      { label: "Web", chips: ["React", "Node.js", "Express", "HTML / CSS"] },
      { label: "Mobile", chips: ["Android", "React Native"] },
      { label: "Data · AI", chips: ["MongoDB", "Firebase", "Gemini API"] },
      { label: "Tools", chips: ["Git", "Postman", "Netlify"] },
    ],
  },
  {
    at: 0.84,
    number: "05",
    label: "Beyond code",
    title: "Beyond Code",
    body: "Communities and competitions that taught me as much as class did.",
    items: [
      { name: "Microsoft Student Chapter", meta: "Tech Team · VIT-AP" },
      { name: "Smart India Hackathon", meta: "Android development" },
      { name: "Capture the Flag", meta: "Cybersecurity event" },
      { name: "Google Developer Groups", meta: "On campus" },
    ],
  },
];

export const finale = {
  number: "06",
  label: "Let's ride together",
  title: ["End of the road.", "Not the journey."],
  body: "Open to internships and good collaborations, especially full-stack and AI/ML work.",
};
