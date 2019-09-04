
import * as path from 'path';
import * as azure from 'azure-storage';
import Log from './logger';
import * as btrfs from './btrfs';

export async function listBackups(p:{ log:Log, blobService:azure.BlobService, blobContainer:string, name:string }) : Promise<{ last:btrfs.BackupEntry, lastFull:btrfs.BackupEntry, list:btrfs.BackupEntry[] }>
{
	const blobs = await listBlobs({ log:p.log, blobService:p.blobService, blobContainer:p.blobContainer });
	const files = blobs.map( blob=>({ name:blob.name, size:parseInt(blob.contentLength) }) );
	return btrfs.createBackupsList({ log:p.log, name:p.name, files });
}

/** Either provide parameters ['path'] or ['dir'+'name'] to specify which file to upload */
export async function uploadFile(p:{ log:Log, blobService:azure.BlobService, blobContainer:string, name?:string, dir?:string, path?:string }) : Promise<azure.BlobService.BlobResult>
{
	let fileName : string;
	let filePath : string;
	if( p.path != null )
	{
		fileName	= path.basename( p.path );
		filePath	= p.path;
	}
	else if( p.name == null )
		throw 'Missing parameter "name"';
	else if( p.dir == null )
		throw 'Missing parameter "dir"';
	else
	{
		fileName	= p.name;
		filePath	= path.join( p.dir, p.name );
	}

	const task = new Promise<azure.BlobService.BlobResult>( (resolve,reject)=>
		{
			p.log.log( `Upload file '${filePath}' (${fileName}) to Azure blob container '${p.blobContainer}'` );
			p.blobService.createBlockBlobFromLocalFile( p.blobContainer, fileName, filePath, function(error,result)
				{
					if( error != null )
					{
						p.log.log( `Upload failed` );
						reject( error );
						return;
					}
					p.log.log( `Upload succeeded` );
					resolve( result );
				} );
		} );
	return task;
}

export async function downloadFile(p:{ log:Log, blobService:azure.BlobService, blobContainer:string, name:string, dir:string }) : Promise<azure.BlobService.BlobResult>
{
	const outputPath = path.join( p.dir, p.name );
	p.log.log( `Downloading file '${outputPath}'` );
	return new Promise<azure.BlobService.BlobResult>( (resolve,reject)=>
		{
			p.blobService.getBlobToLocalFile(p.blobContainer, p.name, outputPath, (error,result)=>
				{
					if( error )
					{
						p.log.log( `Download failed` );
						reject( error );
						return;
					}
					p.log.log( `Download succeeded` );
					resolve( result );
				} );
		} );
}

export async function listBlobs(p:{ log:Log, blobService:azure.BlobService, blobContainer:string, namePrefix?:string }) : Promise<azure.BlobService.BlobResult[]>
{
	let entries : azure.BlobService.BlobResult[] = [];
	let token : azure.common.ContinuationToken = null;
	p.log.log( `List blobs of container '${p.blobContainer}'` );
	do
	{
		let task : Promise<azure.BlobService.ListBlobsResult>;
		if( p.namePrefix == null )
		{
			// Use 'listBlobsSegmented'
			task = new Promise<azure.BlobService.ListBlobsResult>( (resolve,reject)=>
				{
					p.blobService.listBlobsSegmented( p.blobContainer, token, null, (error,result)=>
						{
							if( error )
							{
								reject( error );
								return;
							}
							resolve( result );
						} );
				} );
		}
		else
		{
			// Use 'listBlobsSegmentedWithPrefix'
			task = new Promise<azure.BlobService.ListBlobsResult>( (resolve,reject)=>
				{
					p.blobService.listBlobsSegmentedWithPrefix( p.blobContainer, p.namePrefix, token, null, (error,result)=>
						{
							if( error )
							{
								reject( error );
								return;
							}
							resolve( result );
						} );
				} );
		}
		const rv = await task;

		p.log.log( `Request returned '${rv.entries.length}' entries` );
		entries = entries.concat( rv.entries );

		token = rv.continuationToken;
	}
	while( token != null );

	p.log.log( `Total: '${entries.length}' entries` );
	return entries;
}

export async function deleteBlob(p:{ log:Log, blobService:azure.BlobService, blobContainer:string, name:string }) : Promise<boolean>
{
	p.log.log( `Delete blob '${p.name}' from container '${p.blobContainer}'` );
	const task = new Promise<boolean>( (resolve,reject)=>
		{
			p.blobService.deleteBlobIfExists( p.blobContainer, p.name, function(error,result)
			{
				if( error != null )
				{
					reject( error );
					return;
				}
				resolve( result );
			} );
		} );
	const rv = await task;
	p.log.log( rv ? `Delete succeeded` : 'Delete failed (file does not exist)' );
	return rv;
}
