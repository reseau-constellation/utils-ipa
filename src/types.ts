export type Suivi<T> = ((x: T) => void) | ((x: T) => Promise<void>);

export type Oublier = () => Promise<void>;

export type PasNondéfini<T = unknown> = T extends undefined ? never : T;

export type ÉlémentsBd =
  | number
  | boolean
  | string
  | { [clef: string]: ÉlémentsBd }
  | Array<ÉlémentsBd>;

export type Journal = (e: Error) => Promise<void> | void;
