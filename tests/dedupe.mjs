// dedupe: same-place matching, merge patches, duplicate groups. Pure logic, no browser. Run: node tests/dedupe.mjs
import { sameSpot, findDup, mergePatch, dupGroups, foldPatch, seenNote, norm } from "../dedupe.js";
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + m); };
const T = (title, o = {}) => ({ id: title + Math.random(), title, ...o });

ok(norm("Tiramisù") === "tiramisu", "accents drop");
ok(sameSpot(T("100 Tiramisù"), T("100 tiramisu")), "accent + case");
ok(sameSpot(T("Tiramisu Roma"), T("The Tiramisu Roma!")), "article + punctuation");
ok(sameSpot(T("Il Colosseo"), T("Colosseo")), "Italian article");
ok(sameSpot(T("Trevi Fountain"), T("Trevi Fountain, Rome")), "contained name");
ok(sameSpot(T("Pasticceria Tiramizu"), T("Pasticceria Tiramisu")), "one typo");
ok(!sameSpot(T("100 Montaditos"), T("100 Tiramisù")), "different places sharing a number");
ok(!sameSpot(T("Pizza"), T("Pizza Napoli")), "short generic name is not enough");
ok(!sameSpot(T("Rome"), T("Rome Colosseum")), "short name is not enough");
const rome = { lat: 41.9, lng: 12.5 }, flo = { lat: 43.77, lng: 11.25 };
ok(!sameSpot(T("100 Montaditos", rome), T("100 Montaditos", flo)), "same chain, different cities");
ok(sameSpot(T("100 Montaditos", rome), T("100 Montaditos", { lat: 41.9005, lng: 12.5003 })), "same name, same spot");
ok(sameSpot(T("Pizza Napoli", rome), T("Pizza Napoli Trastevere", { lat: 41.9001, lng: 12.5001 })), "near pins + shared words");
ok(!sameSpot(T("Gelateria Verde", rome), T("Gelateria Blu", { lat: 41.9001, lng: 12.5001 })), "neighbours stay apart");
ok(sameSpot(T("Trevi Fountain", rome), T("Trevi Fountain")), "one side without a pin falls back to the name");
ok(!sameSpot({ title: "Rest", rest: true }, { title: "Rest", rest: true }), "rest blocks never match");

ok(findDup([T("A place"), T("Colosseum Rome")], { title: "the colosseum, rome" })?.title === "Colosseum Rome", "findDup");

const have = { notes: "Tip: book 2 days ahead", url: "https://a.example/1", description: "", lat: undefined, votes: { a: "love" } };
const p = mergePatch(have, { notes: "Tip: book 2 days ahead · Tip: go early", url: "https://b.example/2", description: "Great", lat: 1, lng: 2, votes: { b: "love" }, cost: 20, veg: "yes" });
ok(p.notes === "Tip: book 2 days ahead · Tip: go early · Also: https://b.example/2", "notes keep old, add new tip and the other link");
ok(p.description === "Great" && p.lat === 1 && p.cost === 20 && p.veg === "yes" && !("url" in p), "gaps filled, url kept");
ok(p.votes.a === "love" && p.votes.b === "love", "votes unioned");
ok(Object.keys(mergePatch({ notes: "x", url: "https://a" }, { notes: "x", url: "https://a" })).length === 0, "nothing new, empty patch");

const day = (t, o) => T(t, o);
const a = day("100 Tiramisù", { addedAt: 3, notes: "one" }), b = day("100 tiramisu", { addedAt: 1, notes: "two", description: "d" }), c = day("100 Tiramisù Roma", { addedAt: 2 });
const onDay = day("Colosseum", { dayId: "d1" }), copy = day("The Colosseum", {}), copy2 = day("Colosseum", { dayId: "d2" });
const gs = dupGroups([a, b, c, onDay, copy, copy2, T("Unique")], (i) => !!i.dayId);
ok(gs.length === 2, "two groups");
const g1 = gs.find((g) => norm(g.keep.title).includes("tiramisu"));
ok(g1.keep === b && g1.drop.length === 2, "keeps the fullest, oldest card");
const g2 = gs.find((g) => norm(g.keep.title).includes("colosseum"));
ok(g2.keep === onDay && g2.drop.length === 1 && g2.drop[0] === copy, "keeps the one on a day; a copy on another day is left alone");
ok(foldPatch(b, [a, c]).notes === "two · one", "fold gathers notes");
ok(seenNote([{ title: "X", merged: true, day: 0 }]).includes("already in Ideas"), "note: ideas");
ok(seenNote([{ title: "X", merged: true, day: 2 }]).includes("Day 2"), "note: day");
ok(seenNote([{ title: "X" }]) === "", "note: nothing merged");
process.exit(fails ? 1 : 0);
