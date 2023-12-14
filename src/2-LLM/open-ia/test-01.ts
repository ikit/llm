
import { getEncycloFromCsv } from "../../1-LoadDocument/puissance-zelda";
// Embedding
import { Chroma } from "langchain/vectorstores/chroma";
import { ChromaClient, Collection, OpenAIEmbeddingFunction } from 'chromadb' // DB pour s'interfacer avec un LLM
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
// LLM
import { RetrievalQAChain } from "langchain/chains";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { PromptTemplate } from "langchain/prompts";
import { VectorStoreRetriever } from "langchain/dist/vectorstores/base";
import { EncycloData } from "../../1-LoadDocument/encyclo-data.model";
import { formatDuration, intervalToDuration } from "date-fns";


export async function embeddingData(dbName: string, data: EncycloData[], forceCreation=false): Promise<Collection> {
    dbName = `OpenAI-${dbName}`;
    console.log("getOrCreateChromaDb: " + dbName);
    
    // On crée le client vers la base de données vectorielle
    const client = new ChromaClient();
    const embeddingFunction = new OpenAIEmbeddingFunction({ openai_api_key: process.env.OAIK });

    // On supprime la collection si elle existe déjà pour assurer que l'étape de création fonctionne
    const collections = await client.listCollections()
    const col = collections.find(c => c.name === dbName);
    if (col && forceCreation) {
        console.log(" > Suppression de la base " + col.name);
        await client.deleteCollection({ name: col.name });
    }
    
    let collection = null;
    if (forceCreation || !col)
    {
        console.log(" > Création de la base " + dbName);
        collection = await client.createCollection({ 
            name: dbName,
            embeddingFunction
        });
        // On y ajoute nos données persos
        console.log(` > Ajout des ${data.length} documents à la base Chroma`);
        const start = new Date().getTime();
        await collection.add({
            ids: data.map(d => d.name),
            metadatas: data.map(d => ({ source: `${d.name}: ${d.url}`})),
            documents: data.map(d => d.text)
        });
        const duration = intervalToDuration({ start: 0, end: new Date().getTime() - start });
        console.log(` > Durée de l'embedding: ${formatDuration(duration, {
            format: duration.minutes ? ["minutes", "seconds"] : ["seconds"],
            zero: true,
            delimiter: ", "
        })}`)
    } else {
        console.log(" > Récupération de la base Chroma");
        collection = await client.getCollection({
            name: col.name,
            embeddingFunction
        });
    };

    return collection;
}


export async function retriever(chromaDb: Collection) {
    console.log("chromaDb requêtage base vectoriel")

    console.log(" > Retriever d'OpenIA");
    const vectorStore = await Chroma.fromExistingCollection(
        new OpenAIEmbeddings({ openAIApiKey: process.env.OAIK }),
        { collectionName: chromaDb.name },
    );
    // console.log("\n\n====\n\n", vectorStore.similaritySearch("Abeille", 2), "\n\n")

    return vectorStore.asRetriever();
}


export async function chatBot(retriever: VectorStoreRetriever) {
    console.log("Création du ChatBot")
    console.log(" > Récupération du LLM GPT 3.5")
    const llm = new ChatOpenAI({ 
        openAIApiKey: process.env.OAIK
    });

    // On crée le template du prompt chatBot pour conditionner l'IA et lui donner le context "data" pour répondre les questions de l'utilisateur
    console.log(" > Création du contexte");
    const template = `Tu es un assitant qui parle français et qui peut peut répondre aux questionssur l'encyclopédie de Zelda. 
    Utilise seulement le contexte et répond aux questions en Français. 
    Si tu ne trouve pas la réponse dans le contexte, répond que l'information ne se trouve pas dans l'Encyclopédie Zelda.
    Contexte : {context}
    Question : {question}`;

    // On utlise langchain pour "brancher le LLM (chatBot) avec notre base de donnée vectorisée"
    console.log(" > Requetage de la base vectorielle via le LLM");
    return RetrievalQAChain.fromLLM(llm, retriever, {
        prompt: PromptTemplate.fromTemplate(template),
        returnSourceDocuments: true,
    });
}

export async function openAiTest01(query: string) {
    console.log("Ma question: " + query,"\n---");
    const data = getEncycloFromCsv("zelda.csv");
    const collection = await embeddingData("zelda.csv", data);
    const vectorStoreRetriever = await retriever(collection);
    const chat = await chatBot(vectorStoreRetriever);

    const start = new Date().getTime();
    const res = await chat.call({ query });
    const duration = intervalToDuration({ start: 0, end: new Date().getTime() - start });
    console.log(`"---\nTraitement: ${formatDuration(duration)}`)

    console.log("---\nRéponse de l'IA:\n", res.text, "\nSources:");
    for (const r of res.sourceDocuments) {
        console.log(" - " + r.metadata.source);
    }
}
