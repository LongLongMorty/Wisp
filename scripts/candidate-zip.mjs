// Deterministic ZIP32 (stored entries, DOS epoch); no package dependency.
export function zip(files) {
    const local=[],central=[];let offset=0;
    for(const {name,bytes} of [...files].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
        if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(s=>s==='..'||s===''))throw Error('Unsafe ZIP entry');
        if(bytes.length>0xffffffff)throw Error('ZIP64 required');
        const filename=Buffer.from(name);let crc=0xffffffff;
        for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
        const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(filename.length,26);
        const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);header.copy(entry,6,4,28);entry.writeUInt32LE(offset,42);
        local.push(header,filename,bytes);central.push(entry,filename);offset+=header.length+filename.length+bytes.length;
    }
    if(files.length>65535||offset>0xffffffff)throw Error('ZIP64 required');
    const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
    return Buffer.concat([...local,directory,end]);
}
