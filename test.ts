
import * as path from 'path';
import * as fs from 'fs';
import * as moment from 'moment';
import Log from './logger';
import * as common from './common';

async function main() : Promise<void>
{
	const log = new Log( 'test' );
	log.log( '*** start' );
	try
	{
		common.init( log );

		log.log( 'Hello world' );

		log.log( 'Exit' );
	}
	catch( ex )
	{
		log.exception( ex );
		common.setHasErrors();
	}
	log.log( '*** end ; hasErrors', common.hasErrors );
}

main();
