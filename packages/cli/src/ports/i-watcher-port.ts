export type FileChangeEvent = 'add' | 'change' | 'unlink';

export type FileChangeHandler = (event: FileChangeEvent, filePath: string) => void;

export interface IWatcherPort {
  start(handler: FileChangeHandler): void;
  stop(): Promise<void>;
}
