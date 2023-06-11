const express = require( 'express' );

const app = express();

app.get( '/', (req,res)=>
	{
		res.send( 'Marchage !' );
	} );

app.listen( 5000, ()=>
	{
		console.log( `Server running @ port 5000`);
	} );
