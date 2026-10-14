export const LEVEL_COUNT = 80;
export const CAP_DEFAULT = 4;
export const STARTING_COINS = 80;
export const UNDO_FREE = 5;

export const PALETTE = [
  "#ff5d7a",
  "#ffd166",
  "#2ee9a6",
  "#4cc9f0",
  "#c77dff",
  "#ff7b2e",
  "#80ffdb",
  "#f72585",
  "#8ac926",
  "#4895ef",
  "#f94144",
  "#f4e285",
] as const;

export type Jar = number[];

export type GameState = {
  jars: Jar[];
  cap: number;
};

export type Move = {
  from: number;
  to: number;
  count: number;
  color: number;
  payload: number[];
};

export type LevelSpec = {
  id: number;
  colors: number;
  empties: number;
  cap: number;
  scramble: number;
  mystery: number;
  ice: number;
  moveLimit: number;
};

export type SaveData = {
  coins: number;
  maxUnlocked: number;
  stars: number[];
  sound: boolean;
  haptic: boolean;
  seenLessons: string[];
  locale: "en" | "vi";
};

export type PlayStats = {
  undos: number;
  hints: number;
  extraJar: boolean;
  moves: number;
  comboMax: number;
  extraMoves: number;
};
