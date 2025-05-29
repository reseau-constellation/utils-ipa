export type schémaFonctionSuivi<T> =
  | ((x: T) => void)
  | ((x: T) => Promise<void>);

export type schémaFonctionOublier = () => Promise<void>;

export type PasNondéfini<T = unknown> = T extends undefined ? never : T;

export type élémentsBd =
  | number
  | boolean
  | string
  | { [clef: string]: élémentsBd }
  | Array<élémentsBd>;

export type Journal = ((e: Error)=>(Promise<void>|void));
