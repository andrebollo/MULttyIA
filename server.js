import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
// CORREÇÃO: Importação CommonJS do paho-mqtt para Node.js
const Paho = require('paho-mqtt');

dotenv.config();

const app = express();
const port = process.env.PORT || 0; // Usa 3000 se não definido no .env
const MQTT_HOST = process.env.MQTT_HOST || "broker.emqx.io";
const MQTT_PORT = parseInt(process.env.MQTT_PORT || 8083);
const MQTT_PATH = process.env.MQTT_PATH || "/mqtt";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let mqttClient;
let isConnectedToMQTT = false;
const myId = "server_agent_" + Math.random().toString(16).substr(2, 8);

// Função para iniciar o MQTT
function startMQTT() {
    const clientId = `multry_server_${Date.now()}`;
    // CORREÇÃO: Configuração Paho MQTT (Node.js)
    const connectOptions = {
        onSuccess: () => {
            isConnectedToMQTT = true;
            console.log("Backend MQTT Connected");
            mqttClient.subscribe(`+/multry/#`, (err) => {
                console.log("Erro ao assinar tópicos gerais: ", err);
                // Tenta assinar salas específicas (Melhor que assinar na desconexão para receber comandos de sala específica se necessário)
                for (let key in users) {
                    mqttClient.subscribe(`multry/${key}/serial/input`);
                }
            });
        },
        onFailure: (err) => console.error("MQTT Connection Failed", err),
        keepAliveInterval: 30,
        timeout: 10,
        mqttVersion: 4
    };

    mqttClient.connect({
        host: MQTT_HOST,
        port: MQTT_PORT,
        path: MQTT_PATH,
        clientId: clientId,
        connectOptions: connectOptions
    });
}

// Inicia conexão MQTT assim que possível
startMQTT();

// --- API do Agente ---

app.post('/api/ask', async (req, res) => {
    try {
        const { room, username, logs, question } = req.body;

        if (!logs || !question || !room) {
            return res.status(400).json({ error: "Faltam dados (room, username, logs, question)" });
        }

        const systemPrompt = `
            Você é um Engenheiro de Rede experiente.
            Analise os logs abaixo de um equipamento conectado serialmente.
            Se o usuário pedir para investigar um problema (ex: "O IP não pinga"), responda com análise técnica detalhada.
            Se você identificar o problema e houver um comando de correção, envie o comando no formato [CMD]comando[/CMD].
        `;

        const conversationHistory = [
            { role: "system", content: systemPrompt }
        ];

        conversationHistory.push({ role: "user", content: `Nome: ${username}\nLogs do Sistema:\n${logs}` });

        const completion = await openai.chat.completions({
            model: "gpt-4o",
            messages: conversationHistory,
            temperature: 0.3,
            max_tokens: 500 
        });

        const aiResponse = completion.choices[0].message.content;

        // Regex simplificado para evitar o SyntaxError anterior
        // Procura por [CMD]...[/CMD]
        const cmdMatch = aiResponse.match(/\[CMD\]([\s\S]*?)\[\/CMD\]/);
        
        let commandToSend = null;
        let finalResponse = aiResponse;

        if (cmdMatch) {
            commandToSend = cmdMatch[1];
            finalResponse = "Comando detectado. Enviando para a serial...";
        } else {
            finalResponse = aiResponse;
        }

        if (commandToSend) {
            // Envia para a sala específica: sala/serial/input
            // O botão Conectar Serial do usuário conectado estará inscrito no `serial/input`.
            // O MQTT envia esse comando para o usuário com a porta aberta.
            const topic = `${room}/serial/input`;
            const mqttMsg = new Paho.Message(commandToSend);
            mqttMsg.qos = 1;
            mqttClient.send(mqttMsg);
        }

        res.json({ response: finalResponse, command: commandToSend });

    } catch (error) {
        console.error("Erro na OpenAI:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Agente IA rodando em http://localhost:${port}`);
    startMQTT(); // Inicia MQTT no backend
});
