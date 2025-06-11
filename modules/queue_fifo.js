class Queue {
    constructor() {
        this.count = 0;
        this.storage = {};
    }

    enqueue(data) {
        this.storage[this.count] = data;
        this.count++;
    }

    dequeue() {
        if (this.count === 0)
            return undefined;

        this.count--;

        let result = this.storage[this.count];
        delete this.storage[this.count];
        
        return result;
    }
}

module.exports = {
    Queue
}