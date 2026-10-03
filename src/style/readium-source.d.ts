/** A ReadiumCSS sheet, text in the bundle so nothing is fetched at run time. */
declare module "@readium/css/css/dist/*.css" {
  const sheet: string;
  export default sheet;
}
