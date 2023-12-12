
import axios from "axios";
import { select } from "xpath"
import { DOMParser } from "@xmldom/xmldom";
import * as csv2json from "json-2-csv";
import * as fs from "fs";
import { EncycloData } from "./encyclo-data.model";

// Récupération d'une base de donnée
// wiki Zelda: https://www.puissance-zelda.com/encyclopedie
export async function getZeldaEncyclopedia(): Promise<EncycloData[]> {
    const htmlPage = await axios.get("https://www.puissance-zelda.com/encyclopedie");
    var xml = htmlPage.data;
    var doc = new DOMParser({errorHandler: function(){}}).parseFromString(xml, 'text/xml');
    var nodes = select("//ul[@class=\"lettreEncyclo\"]/li/a/@href", doc) as any[];
    
    const db:string[] = nodes.map(n => n.nodeValue);

    // A partir des liens du sommaire, on récupère les artcicles
    async function getText(url: string) {
        const htmlPage = await axios.get(url);
        var xml = htmlPage.data;
        var doc = new DOMParser({errorHandler: function(){}}).parseFromString(xml, 'text/xml');
        const res = select("//div[@class=\"col-12 mb-lg-3\"]/text()", doc);
        return res.toString().replace( /[\r\n]+/gm, "" ).replace( /[\t]+/gm, "" );
    }

    const res = [];
    let count = 0;
    for (const url of db) {
        count += 1;
        process.stdout.write(`\rRécupération du contenu: ${count}/${db.length}`);
        res.push({ 
            name: url.substring(49),
            url: url as string,
            text: await getText(url)
        });
    }
    console.log("")
    return res;
}

// On sauvegarde en local dans un fichier csv
export async function encycloToCsv(data: EncycloData[], filename: string) {
    fs.writeFileSync(filename, csv2json.json2csv(data));
}
export function getEncycloFromCsv(filename: string): EncycloData[]  {
    const csv = csv2json.csv2json(fs.readFileSync(filename, { encoding:"utf8"})) as EncycloData[];
    return csv;
}
