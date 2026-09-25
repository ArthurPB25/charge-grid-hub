/*
 * ChargeGrid Hub — firmware do ESP32
 *
 * Parte do código de partida (conexão Wi-Fi/MQTT no Wokwi, controle do relé
 * pelo comando LIGAR/DESLIGAR) é a base que já foi escrita e testada. Este
 * arquivo estende essa base com duas coisas que faltavam para o comportamento
 * ficar mais fiel a um carregador real:
 *
 *   1. Sensor de cabo conectado — sem ele, o relé fechava só porque o site
 *      mandou o comando, mesmo sem nada plugado na tomada. Um carregador de
 *      verdade nunca energiza o conector antes de detectar o veículo
 *      conectado (é o que a Control Pilot faz na IEC 61851); aqui isso é
 *      feito com uma chave fim-de-curso simples.
 *
 *   2. Verificação contínua, não só na chegada da mensagem — antes, o relé
 *      só mudava de estado quando uma mensagem MQTT chegava. Agora, a cada
 *      volta do loop() o estado do relé é recalculado a partir do último
 *      comando recebido E do sensor de cabo lido na hora. Isso significa que
 *      se alguém desconectar o cabo no meio do carregamento, a energia é
 *      cortada imediatamente — não é preciso esperar o site mandar um novo
 *      comando.
 *
 * O ESP32 também agora publica o estado real de volta para o site (tópico de
 * status), porque sem isso o site só sabe o que ELE mandou, não o que
 * realmente aconteceu no hardware — e as duas coisas podem divergir (por
 * exemplo, comando de ligar chegando sem o cabo conectado).
 */

#include <WiFi.h>
#include <PubSubClient.h>

// Configurações do Wi-Fi do Wokwi (não mude para testar na simulação;
// troque pelo Wi-Fi real só quando for gravar no ESP32 físico)
const char* ssid = "Wokwi-GUEST";
const char* password = "";

// Configurações do servidor MQTT público (mesmo broker do protótipo original)
const char* mqtt_server = "broker.emqx.io";
const int mqtt_port = 1883;

// Tópicos MQTT
const char* topico_comando = "meu_projeto/tomada/comando"; // site -> ESP32
const char* topico_rele = "meu_projeto/tomada/rele"; // controle automático de demanda
const char* topico_status  = "meu_projeto/tomada/status";  // ESP32 -> site

// Pinos
const int RELE_PIN = 2;  // controla o relé (circuito de força)
const int CABO_PIN = 4;  // chave fim-de-curso do sensor de cabo conectado

// Debounce do sensor mecânico: exige a mesma leitura por N ciclos seguidos
// antes de considerar o estado como estável, para ignorar o "chacoalhar"
// elétrico natural de uma chave mecânica no instante do contato.
const int DEBOUNCE_CICLOS = 3;
int leituraCaboEstavel = HIGH;
int contadorDebounce = 0;

WiFiClient espClient;
PubSubClient client(espClient);

bool comandoLigar = false;   // último comando recebido do site
bool caboConectado = false;  // estado atual do sensor, já com debounce
bool releLigado = false;     // estado atual do relé (o que de fato importa)

void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Conectando ao Wi-Fi...");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" Conectado!");
}

// Função executada sempre que chega uma mensagem MQTT do site.
// Ela só guarda a intenção do site — quem decide o estado real do relé é o
// loop(), que também considera o sensor de cabo.
void callback(char* topic, byte* payload, unsigned int length) {
  String mensagem;
  for (unsigned int i = 0; i < length; i++) {
    mensagem += (char)payload[i];
  }

  Serial.print("Comando recebido do site: ");
  Serial.println(mensagem);

  if (mensagem == "LIGAR") {
    comandoLigar = true;
  } else if (mensagem == "DESLIGAR") {
    comandoLigar = false;
  }
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Tentando conexão MQTT...");
    String clientId = "ChargeGridESP32-" + String(random(0, 1000));
    if (client.connect(clientId.c_str())) {
      Serial.println("Conectado ao Broker MQTT!");
      client.subscribe(topico_comando);
      client.subscribe(topico_rele);
    } else {
      Serial.print("Falhou, rc=");
      Serial.print(client.state());
      Serial.println(" Tentando novamente em 5 segundos");
      delay(5000);
    }
  }
}

// Lê a chave fim-de-curso com debounce simples. A chave liga o pino ao GND
// quando pressionada (cabo encaixado); INPUT_PULLUP mantém o pino em HIGH
// quando solto, então LOW = cabo conectado.
void atualizarSensorCabo() {
  int leituraAtual = digitalRead(CABO_PIN);

  if (leituraAtual == leituraCaboEstavel) {
    contadorDebounce = 0;
  } else {
    contadorDebounce++;
    if (contadorDebounce >= DEBOUNCE_CICLOS) {
      leituraCaboEstavel = leituraAtual;
      contadorDebounce = 0;
    }
  }

  caboConectado = (leituraCaboEstavel == LOW);
}

// O coração da segurança do sistema: o relé só fecha se as duas condições
// forem verdadeiras ao mesmo tempo. É reavaliado a cada volta do loop, não
// só quando uma mensagem chega.
void atualizarRele() {
  bool deveLigar = comandoLigar && caboConectado;

  if (deveLigar != releLigado) {
    releLigado = deveLigar;
    digitalWrite(RELE_PIN, releLigado ? HIGH : LOW);
    Serial.println(releLigado ? "Relé FECHADO — energia liberada" : "Relé ABERTO — energia cortada");
    publicarStatus();
  }
}

void publicarStatus() {
  String status;
  if (releLigado) {
    status = "CARREGANDO";
  } else if (comandoLigar && !caboConectado) {
    status = "AGUARDANDO_CABO";
  } else {
    status = "PARADO";
  }
  client.publish(topico_status, status.c_str());
}

void setup() {
  Serial.begin(115200);

  pinMode(RELE_PIN, OUTPUT);
  digitalWrite(RELE_PIN, LOW); // garante que comece desligado

  pinMode(CABO_PIN, INPUT_PULLUP);

  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  atualizarSensorCabo();
  atualizarRele();

  delay(20); // ritmo de leitura do sensor — não precisa ser mais rápido que isso
}
