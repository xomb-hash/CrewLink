declare module 'twitter-text' {
  export interface ParsedTweet {
    weightedLength: number;
    valid: boolean;
    permillage: number;
    displayRangeStart: number;
    displayRangeEnd: number;
    validRangeStart: number;
    validRangeEnd: number;
  }

  export function parseTweet(text: string): ParsedTweet;
  export function extractUrls(text: string): string[];

  const twitterText: {
    parseTweet: typeof parseTweet;
    extractUrls: typeof extractUrls;
  };
  export default twitterText;
}
