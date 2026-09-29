export {};

declare global {
  const Bun: {
    write(path: string, data: string): Promise<number>;
  };
}
