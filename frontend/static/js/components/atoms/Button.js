/* Create the Button Atom component. This is a Dumb Component. */

class Button extends BaseComponent {
    constructor(config) {
        super(config);
        this.buttonText = config.text || 'Button';
        this.isPrimary = config.variant === 'primary' || true;
        this.isDisabled = config.disabled || false;
    }

    onRender() {
        this.element.innerHTML = `<button 
            class="atom-button ${this.isPrimary ? 'primary' : 'secondary'}"
            ${this.isDisabled ? 'disabled' : ''}
        >
            ${this.buttonText}
        </button>`;
        
        // Setup click listener to emit a generic click event
        this.element.querySelector('button').addEventListener('click', (e) => {
            if (!this.isDisabled) {
                this.eventBus.emit('button:clicked', { 
                    id: this.config.id, 
                    originalEvent: e 
                });
            }
        });
    }
}