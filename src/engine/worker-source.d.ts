/** The worker, bundled to a string by the build so the release is one file. */
declare module "virtual:worker" {
  const source: string;
  export default source;
}
