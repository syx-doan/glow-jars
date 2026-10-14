import { hintMove, isFrozen, isMystery, topValue } from "./engine";
import { t } from "./i18n";
import type { GameState, LevelSpec } from "./types";

export type LessonId = "basics" | "buffer" | "tools" | "mystery" | "ice" | "tight" | "deep";

export type CoachWait =
  | { type: "next" }
  | { type: "select"; jar: number }
  | { type: "pour"; from: number; to: number }
  | { type: "ice"; jar: number }
  | { type: "reveal"; jar: number };

export type CoachTarget =
  | { type: "none" }
  | { type: "jar"; index: number }
  | { type: "jars"; indices: number[] }
  | { type: "orb"; index: number }
  | { type: "orbs"; indices: number[] }
  | { type: "dom"; id: string }
  | { type: "hud" };

export type CoachStep = {
  title: string;
  body: string;
  target: CoachTarget;
  wait: CoachWait;
  card: "top" | "bottom";
};

export type CoachLesson = {
  id: LessonId;
  steps: CoachStep[];
};

export type CoachEvent =
  | { type: "next" }
  | { type: "select"; jar: number }
  | { type: "pour"; from: number; to: number }
  | { type: "ice"; jar: number; thawed: boolean }
  | { type: "reveal"; jar: number };

function findTop(state: GameState, pred: (v: number) => boolean): number | null {
  for (let i = 0; i < state.jars.length; i++) {
    const v = topValue(state.jars[i]!);
    if (v !== null && pred(v)) return i;
  }
  return null;
}

function findAny(
  state: GameState,
  pred: (v: number) => boolean,
): { jar: number; onTop: boolean } | null {
  const top = findTop(state, pred);
  if (top !== null) return { jar: top, onTop: true };
  for (let i = 0; i < state.jars.length; i++) {
    if (state.jars[i]!.some(pred)) return { jar: i, onTop: false };
  }
  return null;
}

function findEmpty(state: GameState): number | null {
  const i = state.jars.findIndex((jar) => jar.length === 0);
  return i >= 0 ? i : null;
}

export function lessonForLevel(spec: LevelSpec, seen: string[]): LessonId | null {
  if (spec.id === 1 && !seen.includes("basics")) return "basics";
  if (spec.id === 2 && !seen.includes("buffer")) return "buffer";
  if (spec.id === 3 && !seen.includes("tools")) return "tools";
  if (spec.id === 4 && !seen.includes("mystery")) return "mystery";
  if (spec.ice && !seen.includes("ice")) return "ice";
  if (spec.mystery && !spec.ice && !seen.includes("mystery")) return "mystery";
  if (spec.empties === 1 && spec.id === 10 && !seen.includes("tight")) return "tight";
  if (spec.cap >= 5 && !seen.includes("deep")) return "deep";
  return null;
}

export function buildLesson(id: LessonId, state: GameState): CoachLesson | null {
  if (id === "basics") {
    const move = hintMove(state);
    const steps: CoachStep[] = [
      {
        title: t("tut.basics.title"),
        body: t("tut.basics.body"),
        target: { type: "none" },
        wait: { type: "next" },
        card: "bottom",
      },
    ];
    if (move) {
      steps.push(
        {
          title: t("tut.pick.title"),
          body: t("tut.pick.body"),
          target: { type: "orb", index: move.from },
          wait: { type: "select", jar: move.from },
          card: "bottom",
        },
        {
          title: t("tut.place.title"),
          body: state.jars[move.to]?.length ? t("tut.place.same") : t("tut.place.empty"),
          target: { type: "orbs", indices: [move.from, move.to] },
          wait: { type: "pour", from: move.from, to: move.to },
          card: "bottom",
        },
      );
    }
    steps.push(
      {
        title: t("tut.seal.title"),
        body: t("tut.seal.body"),
        target: { type: "none" },
        wait: { type: "next" },
        card: "bottom",
      },
      {
        title: t("tut.moves.title"),
        body: t("tut.moves.body"),
        target: { type: "dom", id: "move-chip" },
        wait: { type: "next" },
        card: "bottom",
      },
    );
    return { id, steps };
  }

  if (id === "buffer") {
    const empty = findEmpty(state);
    return {
      id,
      steps: [
        {
          title: t("tut.buffer.title"),
          body: t("tut.buffer.body"),
          target: empty === null ? { type: "none" } : { type: "jar", index: empty },
          wait: { type: "next" },
          card: "bottom",
        },
      ],
    };
  }

  if (id === "tools") {
    return {
      id,
      steps: [
        {
          title: t("tut.undo.title"),
          body: t("tut.undo.body"),
          target: { type: "dom", id: "btn-undo" },
          wait: { type: "next" },
          card: "top",
        },
        {
          title: t("tut.tools.title"),
          body: t("tut.tools.body"),
          target: { type: "hud" },
          wait: { type: "next" },
          card: "top",
        },
      ],
    };
  }

  if (id === "mystery") {
    const found = findAny(state, isMystery);
    const jar = found?.jar ?? null;
    const steps: CoachStep[] = [
      {
        title: t("tut.mystery.title"),
        body: found?.onTop ? t("tut.mystery.top") : t("tut.mystery.buried"),
        target: jar === null ? { type: "none" } : { type: "orb", index: jar },
        wait: { type: "next" },
        card: "bottom",
      },
    ];
    if (found?.onTop && jar !== null) {
      steps.push({
        title: t("tut.reveal.title"),
        body: t("tut.reveal.body"),
        target: { type: "orb", index: jar },
        wait: { type: "reveal", jar },
        card: "bottom",
      });
    }
    steps.push({
      title: t("tut.afterReveal.title"),
      body: t("tut.afterReveal.body"),
      target: jar === null ? { type: "none" } : { type: "orb", index: jar },
      wait: jar === null ? { type: "next" } : { type: "select", jar },
      card: "bottom",
    });
    return { id, steps };
  }

  if (id === "ice") {
    const found = findAny(state, isFrozen);
    const jar = found?.jar ?? null;
    const steps: CoachStep[] = [
      {
        title: t("tut.ice.title"),
        body: found?.onTop ? t("tut.ice.top") : t("tut.ice.buried"),
        target: jar === null ? { type: "none" } : { type: "orb", index: jar },
        wait: { type: "next" },
        card: "bottom",
      },
    ];
    if (found?.onTop && jar !== null) {
      steps.push(
        {
          title: t("tut.crack1.title"),
          body: t("tut.crack1.body"),
          target: { type: "orb", index: jar },
          wait: { type: "ice", jar },
          card: "bottom",
        },
        {
          title: t("tut.crack2.title"),
          body: t("tut.crack2.body"),
          target: { type: "orb", index: jar },
          wait: { type: "ice", jar },
          card: "bottom",
        },
        {
          title: t("tut.melt.title"),
          body: t("tut.melt.body"),
          target: { type: "orb", index: jar },
          wait: { type: "ice", jar },
          card: "bottom",
        },
      );
    }
    steps.push({
      title: t("tut.afterIce.title"),
      body: t("tut.afterIce.body"),
      target: jar === null ? { type: "none" } : { type: "orb", index: jar },
      wait: { type: "next" },
      card: "bottom",
    });
    return { id, steps };
  }

  if (id === "tight") {
    return {
      id,
      steps: [
        {
          title: t("tut.tight.title"),
          body: t("tut.tight.body"),
          target: { type: "dom", id: "move-chip" },
          wait: { type: "next" },
          card: "bottom",
        },
      ],
    };
  }

  return {
    id,
    steps: [
      {
        title: t("tut.deep.title"),
        body: t("tut.deep.body"),
        target: { type: "none" },
        wait: { type: "next" },
        card: "bottom",
      },
    ],
  };
}

export function eventMatches(wait: CoachWait, event: CoachEvent): boolean {
  if (wait.type === "next") return event.type === "next";
  if (wait.type === "select") return event.type === "select" && event.jar === wait.jar;
  if (wait.type === "pour") {
    return event.type === "pour" && event.from === wait.from && event.to === wait.to;
  }
  if (wait.type === "ice") return event.type === "ice" && event.jar === wait.jar;
  if (wait.type === "reveal") return event.type === "reveal" && event.jar === wait.jar;
  return false;
}

export function allowedJar(wait: CoachWait, jar: number, selected: number | null): boolean {
  if (wait.type === "next") return false;
  if (wait.type === "select" || wait.type === "ice" || wait.type === "reveal") return jar === wait.jar;
  if (wait.type === "pour") {
    if (selected === wait.from) return jar === wait.to || jar === wait.from;
    return jar === wait.from;
  }
  return false;
}
