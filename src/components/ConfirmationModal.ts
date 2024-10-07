// src/components/ConfirmationModal.ts
import { App, Modal, ButtonComponent } from "obsidian";

export class ConfirmationModal extends Modal {
  private resolvePromise: (value: boolean) => void;

  constructor(
    app: App,
    private title: string,
    private message: string,
    private confirmButtonText: string = "Confirm",
    private cancelButtonText: string = "Cancel",
    private isDestructiveAction: boolean = false,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl, titleEl } = this;

    titleEl.setText(this.title);

    contentEl.empty();
    contentEl.addClass("confirmation-modal");

    const messageEl = contentEl.createDiv("confirmation-message");
    messageEl.innerHTML = this.message;

    const buttonContainer = contentEl.createDiv("confirmation-buttons");

    new ButtonComponent(buttonContainer)
      .setButtonText(this.cancelButtonText)
      .onClick(() => {
        this.close();
        this.resolvePromise(false);
      });

    const confirmButton = new ButtonComponent(buttonContainer)
      .setButtonText(this.confirmButtonText)
      .setCta()
      .onClick(() => {
        this.close();
        this.resolvePromise(true);
      });

    if (this.isDestructiveAction) {
      confirmButton.setClass("mod-warning");
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  public async awaitUserConfirmation(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }
}
