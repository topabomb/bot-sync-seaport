import { Level } from 'level';
interface STATE_PARTIAL_BASE {
  last: number;
  pendings?: Record<string, any>;
}
class State<T extends STATE_PARTIAL_BASE> {
  private leveldb: { state: Level; pendings: Level };
  private __poppedKeys: Set<string> = new Set<string>();
  private __pendingsLength = 0;
  private __last = 0;
  readonly partial: string;
  readonly path: string;
  readonly defaultValue: T;
  constructor(partial: string, path: string, defaultValue?: T) {
    this.partial = partial;
    this.path = path;
    this.leveldb = {
      state: new Level(`${path}/${partial}/state`),
      pendings: new Level(`${path}/${partial}/pendings`, { valueEncoding: 'json' }),
    };

    this.leveldb.state.open((err) => {
      err && console.error('state open fail', err);
    });
    this.leveldb.pendings.open((err) => {
      err && console.error('pendings open fail', err);
    });

    this.defaultValue = defaultValue ? defaultValue : ({ last: 0 } as T);
  }
  async refresh() {
    try {
      this.__last = Number(await this.leveldb.state.get('last'));
    } catch {
      this.__last = this.defaultValue.last;
    }
    this.__pendingsLength = (await this.leveldb.pendings.keys().all()).length;
    this.__poppedKeys.clear();
  }
  get last() {
    return this.__last;
  }
  get pendingsLength() {
    return this.__pendingsLength - this.__poppedKeys.size;
  }
  async setLast(val: number) {
    await this.leveldb?.state.put('last', val.toString());
    this.__last = val;
  }
  async put(key: string, value: any) {
    if (this.__poppedKeys.has(key)) this.__poppedKeys.delete(key);
    try {
      const old = await this.leveldb.pendings.get(key);
      console.error(`${key}已存在`);
    } catch {
      await this.leveldb?.pendings.put(key, value);
      this.__pendingsLength += 1;
    }
  }
  async del(key: string) {
    if (this.__poppedKeys.has(key)) this.__poppedKeys.delete(key);
    try {
      await this.leveldb?.pendings.del(key);
      this.__pendingsLength -= 1;
    } catch {
      console.log(`del(${key}) LEVEL_NOT_FOUND`);
    }
  }
  async pop(): Promise<any> {
    let val;
    for await (const key of this.leveldb.pendings.keys()) {
      if (!this.__poppedKeys.has(key)) {
        this.__poppedKeys.add(key);
        val = await this.leveldb.pendings.get(key);
        if (typeof val == 'string') val = JSON.parse(val);
        break;
      }
    }
    return val;
  }
  async revertPop() {
    //需要移除的应该调用del方法移除，本方法将未del的pop数据进行回滚
    for (const key of [...this.__poppedKeys.keys()]) {
      this.__poppedKeys.delete(key);
    }
  }
}
export { State, STATE_PARTIAL_BASE };
