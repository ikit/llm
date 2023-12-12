
// Etape 1 Récupération donnée et formatage csv
// Etape 2 - Embedding
import { ChromaClient, Collection, IEmbeddingFunction } from 'chromadb' // DB pour s'interfacer avec un LLM
import { OllamaEmbeddings } from "langchain/embeddings/ollama";
// import { HuggingFaceTransformersEmbeddings } from "langchain/embeddings/hf_transformers"; // API pour utiliser des models pré-entrainé d'IA comme HuggingFace
import { Chroma } from "langchain/vectorstores/chroma";
// Etape 3 - LLM
import { RetrievalQAChain } from "langchain/chains";
import { ChatOllama } from "langchain/chat_models/ollama";
import { PromptTemplate } from "langchain/prompts";
import { VectorStoreRetriever } from "langchain/dist/vectorstores/base";
import { EncycloData } from '../../1-LoadDocument/encyclo-data.model';



export async function embeddingData(dbName: string, data: EncycloData[], forceCreation=false): Promise<Collection> {
    console.log("getOrCreateChromaDb: " + dbName);
    
    // On va se créer notre propre méthode d'embedding basé 
    // sur les modèles pré-entrainé libre de HF
    class MyEmbeddingFunction implements IEmbeddingFunction {
        private embedding: any = null;

        constructor() {
            // On choisi un model de vectorisation pour l'embedding: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
            // On choisi un modèle qui donne la similitude entre différents textes
            // this.pipe = await pipeline.call("sentence-similarity", "sentence-transformers/all-MiniLM-L6-v2");
            this.embedding = new OllamaEmbeddings({
                model: "llama2",
                baseUrl: "http://localhost:11434",
            });
        }
      
        public async generate(texts: string[]): Promise<number[][]> {
            return this.embedding.embedDocuments(texts);
        }
    }
    
    // On crée le client vers la base de données vectorielle
    const client = new ChromaClient();

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
            embeddingFunction: new MyEmbeddingFunction()
        });
        // On y ajoute nos données persos
        console.log(" > Ajout des donnée à la base Chroma");
        let count = 0;
        for (const doc of data) {
            count += 1;
            process.stdout.write(`\rEmbedding document: ${count}/${data.length}`);
            await collection.add({
                ids: doc.name,
                metadatas: { source: `${doc.name}: ${doc.url}`},
                documents: doc.text
            });
        }
    } else {
        console.log(" > Récupération de la base Chroma");
        collection = await client.getCollection({
            name: col.name,
            embeddingFunction: new MyEmbeddingFunction()
        })
    };

    return collection;
}


export async function retriever(chromaDb: Collection) {
    console.log("chromaDb vectorisation for ollama")

    console.log(" > Vectorisation de la collection selon le transformer d'OpenIA");
    const vectorStore = await Chroma.fromExistingCollection(
        new OllamaEmbeddings({
            model: "llama2",
            baseUrl: "http://localhost:11434",
        }),
        { collectionName: chromaDb.name },
    );
    // console.log("\n\n====\n\n", vectorStore.similaritySearch("Abeille", 2), "\n\n")

    return vectorStore.asRetriever();
}


export async function chatBot(retriever: VectorStoreRetriever) {
    console.log("Création du LLM")
    // On défini le LLM à utiliser
    // TODO: utiliser un modèle libre récupéré via HF
    console.log(" > Récupération du modèle: llama2");
    const llm = new ChatOllama({
        baseUrl:"http://localhost:11434",
        model:"llama2",
        verbose: true,
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
    const chain = RetrievalQAChain.fromLLM(llm, retriever, {
        prompt: PromptTemplate.fromTemplate(template),
        returnSourceDocuments: true,
        
    });

    return chain;
}

