# P04637

### That's science's name for the protein that guards your DNA. This project is about translating codes like that into plain English, using an AI that has to cite every fact.

---

Science has published one of its greatest achievements of the decade for anyone to read, and almost nobody can read it.

In 2020, an AI system called AlphaFold cracked a problem biologists had been stuck on for fifty years: predicting the 3D shape of a protein from its recipe. The work later shared the 2024 Nobel Prize in Chemistry. Then something unusual happened. The results, more than 200 million predicted protein structures, were released to the public for free.

You can download the shape of nearly any protein known to science today. It costs nothing and you don't need an account.

But open one of those files and you see a tangle of colored ribbons, a list of codes like "P04637," and database entries written by specialists for specialists. The knowledge is public. The understanding is not.

So I built **foldspeak**, a free web app that turns any protein into a plain-English story. Along the way I ran into a design principle I now think applies to almost every serious use of AI:

**Don't let the AI be the source of the facts. Let it be the explainer.**

---

## First, why should anyone care about proteins?

If DNA is your body's cookbook, proteins are the meals, and also the kitchen, the chefs, and the delivery drivers.

Hemoglobin carries oxygen through your blood. Insulin tells your cells to take in sugar. Collagen holds your skin together. The spike protein let SARS-CoV-2 get into human cells, which is why it became the target of COVID-19 vaccines.

A protein's **shape** is what lets it do its job, the way a key's shape decides which lock it opens. Change one tiny piece of the shape and things can go badly wrong. Sickle cell disease comes down to a single swapped building block in hemoglobin. Cystic fibrosis comes from a faulty protein called CFTR. About half of human cancers involve damage to one protein, p53, often called the "guardian of the genome."

That's why AlphaFold mattered so much. Knowing a protein's shape is the first step toward understanding what it does, what breaks it, and how a drug might fix it.

---

## What foldspeak does

You type a protein's name ("insulin," "p53," "spike protein") and within a couple of seconds you get four things:

1. **The 3D shape**, which you can spin and zoom. It's colored by how confident the AI was about each part: deep blue means "very sure," orange means "a guess."
2. **A map of the important regions.** Click a region, such as the part of p53 that grips DNA, and it lights up on the 3D model.
3. **A plain-English explanation** at the level you choose: *Curious* (no science background needed), *Student*, or *Expert*.
4. **A citation for every claim**, linking back to the scientific record it came from.

It runs entirely for free, for anyone, with no login. You can try it at **foldspeak.troche.workers.dev**.

The interesting part isn't the features. It's what the AI is and isn't allowed to do.

---

## The rule: the AI explains, it doesn't know

Most people now know that AI chatbots sometimes "hallucinate." They produce confident, fluent statements that are simply false. In casual use that's annoying. In science, medicine, law, or finance it's dangerous, and it gets more dangerous the better the writing sounds.

The usual fix is a bigger, smarter model. I went the other way.

When you ask foldspeak about a protein, the AI never answers from memory. The system first collects the facts from trusted public scientific databases: UniProt, AlphaFold, InterPro, and PubMed. It bundles them into a fact sheet. Then it hands the fact sheet to the AI with strict instructions:

- **Use only what's in this fact sheet.**
- **Cite the source for every claim.**
- **If the records don't cover something, say so. Don't fill the gap.**

Think of the difference between a tour guide who improvises and a museum docent who explains what's on the placard in front of them. The docent can still be warm, clear, and engaging. They just aren't allowed to make things up.

This changes what the AI is for. Its job is no longer to *know* biology. Its job is to take dense, accurate, expert-written records and make them understandable. Language models are genuinely good at that.

A nice side effect: a small AI is enough. foldspeak uses a compact model, a fraction of the size of the famous chatbots, because it doesn't need to have memorized the world. It only needs to read well and write clearly.

---

## Honesty is a feature, not a disclaimer

Grounding the AI in real records is the core idea. A few other choices came from the same instinct, which is to make trust *visible* rather than ask for it.

**Show the uncertainty.** AlphaFold's predictions aren't equally reliable everywhere. Some regions are rock solid. Others are floppy and genuinely uncertain. Instead of hiding that, foldspeak colors the model by confidence, so you can see at a glance which parts to trust.

**Show the receipts.** Every claim links to its source. If you doubt a sentence, you're one click from the original record.

**Admit the limits out loud.** The explanations are AI-generated, and a small model occasionally attributes a fact to the wrong source or slips in a general-knowledge sentence. The app says so plainly and tells you to read the citations. Before each release, I read the explanations for well-known proteins by hand. And it is explicitly *not* medical advice. Disease links are presented as what the databases record, never as a diagnosis.

**Treat outside text as data, never as instructions.** The databases contain text written by thousands of contributors. foldspeak walls that text off so the AI reads it as information and can't mistake it for commands. It's a small technical detail with a big principle behind it: what you retrieve should inform the AI, not steer it.

---

## Building something useful for $0

I also set myself a hard constraint: this had to cost nothing to run, permanently. It runs on a free cloud tier, where going over a limit simply pauses the service. It can't produce a surprise bill.

Constraints like that force good decisions. A few of them:

**Prepare for the popular questions in advance.** Most people look up the same famous proteins: insulin, hemoglobin, p53, the spike protein. So the 100 most recognizable ones were prepared ahead of time. For the large majority of visits, the AI never has to run at all. The answer is already there, instantly, for free.

**Show the facts first, explain second.** The 3D shape and the facts appear immediately. The written explanation streams in right after. Someone who only wants to look at the structure never triggers the AI at all.

**Put friction only where the cost is.** There's a quick "are you human?" check, but it only appears when a request would actually make the AI do new work. Someone browsing popular proteins never sees it.

**Fail gracefully, not catastrophically.** The AI has a daily budget, tracked by a built-in circuit breaker. If a busy day uses it up, the app doesn't crash. It tells you that today's AI budget is used up, that existing explanations still work, and that fresh ones resume at midnight. Everything else keeps working.

None of that is exotic. It's ordinary engineering discipline, and it's why a free tool can serve real traffic.

---

## The bigger idea: this pattern works almost everywhere

foldspeak is about proteins, but proteins aren't the point. The pattern applies to any field where three things are true:

1. **Trustworthy information already exists**, in records, documents, or databases.
2. **It's written for experts**, so most people can't use it.
3. **Being wrong has real consequences.**

That describes a lot of the world. Here's how the same principles carry over.

**Healthcare.** Your lab results and doctor's notes are in your patient portal, written in medical shorthand. An assistant grounded *only in your own records* could explain what "eGFR 58" means for you, cite the exact line it came from, and say "your records don't cover that, ask your doctor" instead of guessing.

**Law and contracts.** Leases, employment agreements, and terms of service are public to the people who sign them and unreadable to most of them. A grounded explainer could say "this clause means your landlord can keep your deposit if..." and quote the clause, so you can check it yourself.

**Personal finance.** Pension statements, insurance policies, and mortgage documents are full of facts people can't parse. The same layered approach works here too: a *Curious* version for the account holder and an *Expert* version for their advisor, both built from the same document.

**Government and public services.** Benefit rules and tax guidance are public but notoriously hard to read. An explainer grounded in the official text, with citations, could help people understand what applies to them without inventing eligibility rules that don't exist.

**Customer support and internal knowledge.** Every company has manuals, policies, and past tickets. An assistant that answers *only* from those documents, links to the page it used, and says "I don't have that" when the documents are silent is far more valuable than one that sounds confident and improvises.

**Education.** The same textbook passage can be explained at three depths for three different learners, without ever drifting from the material the teacher assigned.

**Engineering, energy, and climate.** Maintenance manuals, safety data sheets, and environmental datasets hold critical knowledge that field workers and the public often can't decode quickly. Grounding plus visible uncertainty is exactly what those settings need.

In every case the checklist is the same:

- **Separate knowing from explaining.** Facts come from trusted sources. The AI makes them understandable.
- **Show your sources.** Every claim should be one click from its evidence.
- **Make uncertainty visible.** Show what's solid and what's a guess, not just the answer.
- **Let the AI say "I don't know."** A gap admitted beats a gap filled with fiction.
- **Meet people at their level.** One set of facts, explained for the curious, the student, and the expert.
- **Treat outside text as data.** What you retrieve informs the AI. It never gets to steer it.
- **Design for the budget you have.** Prepare the common answers, add friction only where the cost is, and fail gracefully.

---

## The shift worth making

We often treat AI like an oracle and ask it to know everything. The most useful AI systems I've seen work more like a translator standing next to a trustworthy library. They're fluent, patient, and adaptable, and they're honest about what's on the shelf.

The world is full of knowledge that's technically public and practically locked: in scientific databases, legal codes, medical records, and company manuals. Bigger models alone won't unlock it. Systems that keep the facts tied to their sources and let the AI do what it's actually good at, explaining, will.

foldspeak is one small example, built on decades of publicly funded science from UniProt, EMBL-EBI, Google DeepMind, and the U.S. National Library of Medicine. Those public goods made it possible.

**Try it:** foldspeak.troche.workers.dev. Type a protein you've heard of. Insulin, hemoglobin, and p53 are good places to start.

**Explore the code:** github.com/jose-troche/foldspeak

And I'd love to hear from you: **in your field, what knowledge is "public but unreadable"?** That's probably where this pattern belongs next.

---

*foldspeak is an educational tool, not a medical or clinical resource. Structures are AI predictions from AlphaFold DB. Explanations are AI-generated from cited database records and should be checked against those citations.*
