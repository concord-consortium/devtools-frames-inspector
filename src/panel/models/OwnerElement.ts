// OwnerElement - Immutable snapshot of an iframe element's configuration in the parent DOM

export class OwnerElement {
  readonly domPath: string;
  readonly src: string | undefined;
  readonly id: string | undefined;

  constructor(domPath: string, src: string | undefined, id: string | undefined) {
    this.domPath = domPath;
    this.src = src || undefined;
    this.id = id || undefined;
  }

  equals(other: OwnerElement | undefined): boolean {
    if (!other) return false;
    return this.domPath === other.domPath &&
           this.src === other.src &&
           this.id === other.id;
  }

  static fromRaw(domPath: string | null | undefined, src: string | null | undefined, id: string | null | undefined): OwnerElement | undefined {
    if (!domPath) return undefined;
    return new OwnerElement(domPath, src || undefined, id || undefined);
  }
}
