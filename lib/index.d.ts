declare type Diff<T, U> = T extends U ? never : T;
export declare function assert<T>(condition: T): Diff<T, undefined>;
export {};
