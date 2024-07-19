
class Log {
	public readonly parent?: Log;
	public readonly name: string;
	public readonly nameFull: string;
	public readonly lines: LogLine[];

	public readonly onLineAdded?: (self: Log, date: Date, message: any[]) => void;

	constructor(name: string, parent?: Log, onLineAdded?: (self: Log, date: Date, message: any[]) => void) {
		this.parent = parent;
		this.name = name;
		this.nameFull = this.getFullName();
		this.lines = [];

		this.onLineAdded = onLineAdded;
	}

	public log(...optionalParams: any[]): void {
		let args: any[] = Array.prototype.slice.call(arguments);
		let line = { date: new Date(), message: args };
		this.lines.push(line);

		if (this.onLineAdded != null)
			this.onLineAdded(this, line.date, line.message);
	}

	public logLines(text: string): void {
		if (text == null) {
			this.log('<NULL>');
			return;
		}
		var lines = text.split('\n');
		for (let i in lines)
			this.log(lines[i]);
	}

	public error(...optionalParams: any[]): void {
		this.log(...['*** Error:', ...optionalParams]);
	}

	public warning(...optionalParams: any[]): void {
		this.log(...['*** Warning:', ...optionalParams]);
	}

	public exception(ex: any): void {
		this.log('*** Exception:', ex);
	}

	public child(name: string): Log {
		let l = new Log(name, this, this.onLineAdded);
		this.lines.push({ date: new Date(), child: l });
		return l;
	}

	public getLines(): string[] {
		const lines: string[] = [];
		for (let i in this.lines) {
			const line = this.lines[i];
			if (line.child != null)
				lines.push(...line.child.getLines());
			else
				lines.push(this.getLineString({ date: line.date, args: line.message }));
		}
		return lines;
	}

	public getLineString({ date, args: a }: { date?: Date, args: any[] }): string {
		const args = a.slice();
		args.unshift(this.nameFull + ':');
		if (date != null)
			args.unshift(dateString({ d: date }));

		// Convert all arguments to strings and join them with a space
		return args.map(arg => {
			// Use JSON.stringify for objects to get a meaningful string representation
			if (arg instanceof Error)
				return exceptionToString({ ex: arg });
			else if (typeof arg === 'object')
				return JSON.stringify(arg);
			return String(arg);
		}).join(' ');
	}

	private getFullName(): string {
		let name = this.name;
		for (let l = this.parent; l != null; l = l.parent)
			name = l.name + '.' + name;
		return name;
	}
}

type LogLine
	= { date: Date, message: any[], child?: never }
	| { date: Date, message?: never, child: Log }

/** Converts the specified date to a string of type 'YYYY-MM-DD' or 'YYYY-MM-DD HH:mm:ss.SSS' */
function dateString({ d, withTime = true }: { d: Date, withTime?: boolean }): string {
	// Original
	// return moment( d ).format( 'YYYY-MM-DD HH:mm:ss.SSS' );

	// Chat-GPT rewritten:
	const pad = (num: number): string => num.toString().padStart(2, '0');
	const padMilliseconds = (num: number): string => num.toString().padStart(3, '0');
	let str = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	if (withTime)
		str += ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${padMilliseconds(d.getMilliseconds())}`;
	return str;
}

function exceptionToString(p: { ex: Error, includeStackTrace?: boolean }): string {
	const msg = `${p.ex.message}`;
	if ((p.includeStackTrace ?? false) && p.ex.stack)
		return `${msg}\nStack Trace:\n${p.ex.stack}`;
	return msg;
}

export default Log;
