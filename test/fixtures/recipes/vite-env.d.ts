// What `vite/client` declares for `?raw` imports
declare module "*?raw" {
  const text: string;
  export default text;
}
