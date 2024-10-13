import ArweaveSync from "../main";

export class LogManager {
    constructor(private plugin: ArweaveSync, private context: string) { }

    private log(level: string, message: string, ...args: any[]): void {
        console.log(`[${this.context}] [${level}] ${message}`, ...args);
    }

    info(message: string, ...args: any[]): void {
        this.log("INFO", message, ...args);
    }

    warn(message: string, ...args: any[]): void {
        this.log("WARN", message, ...args);
    }

    error(message: string, ...args: any[]): void {
        this.log("ERROR", message, ...args);
    }

    debug(message: string, ...args: any[]): void {
        if (this.plugin.settings.debugMode) {
            this.log("DEBUG", message, ...args);
        }
    }
}