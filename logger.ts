
import * as moment from 'moment';

class Log
{
	public readonly	parent?		: Log;
	public readonly	name		: string;
	public readonly	nameFull	: string;
	public readonly	lines		: LogLine[];

	public readonly onLineAdded?: (name:string, date:Date, message:any[])=>void;

	constructor(name:string, parent?:Log, onLineAdded?:(name:string, date:Date, message:any[])=>void)
	{
		this.parent = parent;
		this.name = name;
		this.nameFull = this.getFullName();
		this.lines = [];

		this.onLineAdded = onLineAdded;
	}

	public log(...optionalParams: any[]) : void
	{
		let args : any[] = Array.prototype.slice.call( arguments );
		let line = { date:new Date(), message:args };
		this.lines.push( line );

		if( this.onLineAdded != null )
			this.onLineAdded( this.nameFull, line.date, line.message );
	}

	public logLines(text:string) : void
	{
		if( text == null )
		{
			this.log( '<NULL>' );	
			return;
		}
		var lines = text.split( '\n' );
		for( let i in lines )
			this.log( lines[i] );
	}

	public exception(ex:any) : void
	{
		this.log( '*** EXCEPTION:', ex );
	}

	public child(name:string) : Log
	{
		let l = new Log( name, this, this.onLineAdded );
		this.lines.push({ date:new Date(), child:l });
		return l;
	}

	public output() : void
	{
		for( let i in this.lines )
		{
			let line = this.lines[i];
			if( line.child != null )
			{
				line.child.output();
			}
			else
			{
				let args = line.message.slice();
				args.unshift( this.nameFull+':' );
				args.unshift( dateString(line.date) );
				console.log.apply( console, args );
			}
		}
	}

	private getFullName() : string
	{
		let name = this.name;
		for( let l = this.parent; l != null; l = l.parent )
			name = l.name+'.'+name;
		return name;
	}
}

type LogLine = { date: Date,	message	: any[],	child?: never	}
			 | { date: Date,	message?: never,	child : Log		}

function dateString(d:Date) : string
{
	return moment( d ).format( 'YYYY-MM-DD HH:mm:ss.SSS' );
}

export default Log;
