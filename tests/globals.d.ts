export {};
declare global {
  var externalUrls: string[];
  var registeredBoardCallbacks: Map<string, () => void>;
}
