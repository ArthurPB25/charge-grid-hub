package br.com.chargegrid.taptest;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.widget.*;
import java.util.UUID;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.ByteArrayOutputStream;
import org.json.JSONObject;

/** Trusted-group presentation: local callback evidence, not bank verification. */
public class MainActivity extends Activity {
    private SharedPreferences prefs;
    private EditText handle;
    private RadioGroup methods;
    private TextView status;
    private Button start;
    private EditText serverAddress, orderCode;
    private Button connect, retry;
    private boolean networking = false;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences("tap-test", MODE_PRIVATE);
        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad * 2, pad, pad);
        scroll.addView(layout);
        setContentView(scroll);
        TextView title = new TextView(this);
        title.setText("ChargeGrid · InfiniteTap v0.4"); title.setTextSize(24); layout.addView(title);
        Button newOrder = new Button(this); newOrder.setText("Novo pedido / digitar código"); layout.addView(newOrder);
        newOrder.setOnClickListener(v -> {
            if (networking) { status.setText("Aguarde a comunicação atual terminar."); return; }
            if (prefs.contains("release_payload")) {
                status.setText("Há um retorno aguardando envio. Use Reenviar retorno ao totem antes de trocar de pedido."); return;
            }
            if (!prefs.contains("order")) { focusCode(); return; }
            new AlertDialog.Builder(this).setTitle("Trocar o teste salvo?")
                .setMessage("Os campos estão bloqueados porque existe um teste anterior salvo. Confira a transação no InfinitePay. Trocar o acompanhamento não cancela nem estorna o pagamento. Se há pedido antigo no totem, cancele-o também por lá.")
                .setNegativeButton("Manter teste", null)
                .setPositiveButton("Conferi · Digitar novo código", (d,w) -> { resetOrder(); focusCode(); }).show();
        });
        TextView copy = new TextView(this);
        copy.setText("Apresentação do grupo · R$ 1,00. Cobrança real com taxas; liberação pelo retorno local, sem consulta bancária independente.\nPreencha os três campos abaixo e conecte o pedido antes de pagar.");
        layout.addView(copy);
        label(layout, "1. InfiniteTag da conta, sem $");
        handle = new EditText(this); handle.setSingleLine(true); handle.setHint("Ex.: minha_conta");
        handle.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        handle.setText(prefs.getString("handle", "")); layout.addView(handle);
        label(layout, "2. Endereço do servidor");
        serverAddress = new EditText(this); serverAddress.setSingleLine(true); serverAddress.setHint("http://IP-DO-COMPUTADOR:3002");
        serverAddress.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        serverAddress.setText(prefs.getString("server", "")); layout.addView(serverAddress);
        label(layout, "3. Código do pedido mostrado no totem");
        orderCode = new EditText(this); orderCode.setSingleLine(true); orderCode.setHint("Ex.: A1B2C3D4");
        orderCode.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        orderCode.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.AllCaps(), new android.text.InputFilter.LengthFilter(8)});
        orderCode.setText(prefs.getString("claim_code", ""));
        orderCode.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_DONE);
        orderCode.setMinHeight((int)(48 * getResources().getDisplayMetrics().density)); layout.addView(orderCode);
        connect = new Button(this); connect.setText("Conectar pedido do totem"); layout.addView(connect);
        methods = new RadioGroup(this);
        RadioButton debit = new RadioButton(this); debit.setId(101); debit.setText("Débito"); methods.addView(debit);
        RadioButton credit = new RadioButton(this); credit.setId(102); credit.setText("Crédito à vista"); methods.addView(credit);
        methods.check(101); layout.addView(methods);
        start = new Button(this); start.setText("Preparar teste de R$ 1,00"); layout.addView(start);
        status = new TextView(this); status.setTextIsSelectable(true); layout.addView(status);
        retry = new Button(this); retry.setText("Reenviar retorno ao totem (sem nova cobrança)"); layout.addView(retry);
        retry.setOnClickListener(v -> sendResult());
        Button clear = new Button(this); clear.setText("Conferi no InfinitePay · Encerrar teste"); layout.addView(clear);
        clear.setOnClickListener(v -> { if (networking) return; new AlertDialog.Builder(this).setTitle("Encerrar acompanhamento?")
            .setMessage("Confira a transação no InfinitePay antes de encerrar. Este botão não cancela nem estorna um pagamento e não libera recarga.")
            .setNegativeButton("Voltar", null).setPositiveButton("Encerrar acompanhamento", (d,w) -> {
                if (prefs.contains("release_payload")) { status.setText("Reenvie o retorno pendente antes de encerrar o acompanhamento."); return; }
                resetOrder();
            }).show(); });
        start.setOnClickListener(v -> prepare());
        connect.setOnClickListener(v -> claim());
        refresh(); receive(getIntent());
    }

    private void label(LinearLayout layout, String text) {
        TextView label = new TextView(this); label.setText(text); layout.addView(label);
    }
    private void resetOrder() {
        prefs.edit().remove("order").remove("nonce").remove("result").remove("phone_token")
            .remove("linked_server").remove("release_payload").remove("launched")
            .remove("order_method").remove("order_label").remove("claim_scope").remove("claim_key").remove("claim_code").apply();
        setIntent(new Intent(this, MainActivity.class)); orderCode.setText(""); refresh();
    }
    private void focusCode() {
        orderCode.requestFocus();
        orderCode.post(() -> ((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE))
            .showSoftInput(orderCode, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT));
    }

    private void prepare() {
        if (prefs.contains("launched") || networking) return;
        String merchant = handle.getText().toString().trim();
        if (!merchant.matches("[A-Za-z0-9_-]{1,100}")) {
            handle.setError("Informe sua InfiniteTag sem $ ou espaços."); return;
        }
        String method = prefs.contains("phone_token") ? prefs.getString("order_method", "debit") : methods.getCheckedRadioButtonId() == 102 ? "credit" : "debit";
        if (!prefs.contains("phone_token") && (!serverAddress.getText().toString().trim().isEmpty() || !orderCode.getText().toString().trim().isEmpty())) {
            status.setText("Conecte primeiro o pedido do totem ou apague servidor/código para testar isoladamente."); return;
        }
        new AlertDialog.Builder(this).setTitle("Abrir cobrança REAL de R$ 1,00?")
            .setMessage("Confirme a conta e o valor também na tela do InfinitePay. Aproximar o cartão e concluir a operação movimenta dinheiro. Para testar somente a abertura, cancele no InfinitePay sem aproximar o cartão.")
            .setNegativeButton("Voltar", null).setPositiveButton("Abrir InfiniteTap", (d,w) -> {
                if (prefs.contains("phone_token")) {
                    final String base = prefs.getString("linked_server", ""), order = prefs.getString("order", ""), token = prefs.getString("phone_token", "");
                    background(() -> post(base, "/api/tap-demo/orders/" + order + "/ready", new JSONObject(), token), response -> launch(merchant, method));
                } else launch(merchant, method);
            }).show();
    }

    private void launch(String merchant, String method) {
        if (prefs.contains("launched")) return;
        String order = prefs.getString("order", "CG-TEST-" + UUID.randomUUID());
        String nonce = UUID.randomUUID().toString();
        Uri callback = new Uri.Builder().scheme("chargegridtap").authority("result").appendPath(nonce).build();
        Uri.Builder uri = new Uri.Builder().scheme("infinitepaydash").authority("infinitetap-app")
            .appendQueryParameter("amount", "100").appendQueryParameter("payment_method", method)
            .appendQueryParameter("order_id", order).appendQueryParameter("result_url", callback.toString())
            .appendQueryParameter("app_client_referrer", "ChargeGridTapTeste").appendQueryParameter("handle", merchant);
        if ("credit".equals(method)) uri.appendQueryParameter("installments", "1");
        prefs.edit().putString("order", order).putString("nonce", nonce).putString("handle", merchant).putBoolean("launched", true).apply();
        refresh();
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri.build())); }
        catch (ActivityNotFoundException e) {
            prefs.edit().remove("launched").remove("nonce").apply(); refresh();
            status.setText("O InfinitePay não abriu. Instale/atualize o aplicativo oficial e confira se o InfiniteTap está disponível.");
        }
    }

    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); receive(intent); }

    private void receive(Intent intent) {
        Uri uri = intent.getData();
        if (uri == null) return;
        String order = prefs.getString("order", "");
        String nonce = prefs.getString("nonce", "");
        // A matching callback correlates this test; it is NOT financial authentication.
        try {
            if (!"chargegridtap".equals(uri.getScheme()) || !"result".equals(uri.getHost()) ||
                nonce.isEmpty() || !("/" + nonce).equals(uri.getPath()) || order.isEmpty() ||
                !order.equals(single(uri, "order_id"))) {
                status.setText("Retorno ignorado: não corresponde ao teste atual. Confira o InfinitePay."); return;
            }
            if (prefs.contains("result")) { refresh(); return; }
            String merchant = single(uri, "handle");
            if (!prefs.getString("handle", "").equals(merchant)) {
                status.setText("Retorno de conta diferente ou sem identificação. Confira a conta no InfinitePay; nenhuma recarga foi liberada."); return;
            }
            JSONObject payload = new JSONObject(); payload.put("order_id", order); payload.put("handle", merchant);
            StringBuilder message = new StringBuilder("Retorno local recebido · demonstração. Confira a transação no InfinitePay.\nPedido: " + order);
            // Do not persist CPF/CNPJ, card data, or the complete callback URI.
            for (String key : new String[]{"nsu", "aut", "card_brand", "warning", "error", "error_message", "error_code", "status", "success", "cancelled", "canceled"}) {
                String value = single(uri, key);
                if (value != null) { message.append("\n").append(key).append(": ").append(value); payload.put(key, value); }
            }
            prefs.edit().putString("result", message.toString()).apply(); refresh();
            if (prefs.contains("phone_token")) {
                prefs.edit().putString("release_payload", payload.toString()).apply(); sendResult();
            }
        } catch (Exception e) {
            status.setText("Retorno inválido. Confira o teste no InfinitePay; nenhuma recarga foi liberada.");
        }
    }

    private String single(Uri uri, String key) {
        java.util.List<String> values = uri.getQueryParameters(key);
        if (values.size() > 1) throw new IllegalArgumentException();
        if (values.isEmpty()) return null;
        String value = values.get(0);
        if (value.length() > 200 || value.chars().anyMatch(c -> c < 32 || c == 127)) throw new IllegalArgumentException();
        return value;
    }

    private void refresh() {
        boolean pending = prefs.contains("order");
        if (pending) handle.setText(prefs.getString("handle", ""));
        if (prefs.contains("phone_token")) methods.check("credit".equals(prefs.getString("order_method", "debit")) ? 102 : 101);
        for (int i = 0; i < methods.getChildCount(); i++) methods.getChildAt(i).setEnabled(!pending && !networking);
        start.setEnabled(!prefs.contains("launched") && !networking); handle.setEnabled(!pending);
        connect.setEnabled(!pending && !networking); serverAddress.setEnabled(!pending && !networking); orderCode.setEnabled(!pending && !networking);
        retry.setVisibility(prefs.contains("release_payload") ? android.view.View.VISIBLE : android.view.View.GONE);
        retry.setEnabled(!networking);
        status.setText(prefs.getString("result", pending
            ? "Pedido: " + prefs.getString("order", "") + "\n" + prefs.getString("order_label", "") + "\n" + (prefs.contains("launched") ? "Aguardando retorno. Não repita a cobrança sem conferir o InfinitePay." : "Conectado. Toque em Preparar teste para abrir o InfiniteTap.")
            : "Nenhum teste em andamento. A cobrança só será aberta após sua confirmação."));
    }

    private interface Job { JSONObject run() throws Exception; }
    private interface Done { void accept(JSONObject data) throws Exception; }
    private void background(Job job, Done done) {
        if (networking) return;
        networking = true; refresh();
        new Thread(() -> {
            try {
                JSONObject data = job.run();
                runOnUiThread(() -> { networking = false; try { done.accept(data); } catch (Exception e) { status.setText("Resposta inesperada. Confira o pedido antes de repetir."); } refreshButtons(); });
            } catch (Exception e) {
                runOnUiThread(() -> { networking = false; refreshButtons(); status.setText("Falha de conexão: " + e.getMessage() + "\nConfira o endereço do servidor e a rede. Se estava conectando o pedido, tente Conectar novamente com os mesmos dados para recuperar a tentativa. Se já pagou, reenvie apenas o retorno."); });
            }
        }).start();
    }
    private void refreshButtons() {
        start.setEnabled(!prefs.contains("launched") && !networking);
        connect.setEnabled(!prefs.contains("order") && !networking);
        retry.setVisibility(prefs.contains("release_payload") ? android.view.View.VISIBLE : android.view.View.GONE);
        retry.setEnabled(!networking);
    }
    private JSONObject post(String base, String path, JSONObject data, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(base + path).openConnection();
        connection.setConnectTimeout(8000); connection.setReadTimeout(8000); connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json");
        if (token != null) connection.setRequestProperty("X-Tap-Token", token);
        try {
            try (java.io.OutputStream out = connection.getOutputStream()) { out.write(data.toString().getBytes("UTF-8")); }
            int code = connection.getResponseCode();
            java.io.InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
            if (stream == null) throw new Exception("HTTP " + code);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buf = new byte[1024]; int n;
            try (java.io.InputStream input = stream) { while ((n = input.read(buf)) != -1) { if (bytes.size() + n > 16384) throw new Exception("Resposta muito grande"); bytes.write(buf, 0, n); } }
            JSONObject response = new JSONObject(bytes.toString("UTF-8"));
            if (code < 200 || code >= 300) throw new Exception(response.optString("erro", "HTTP " + code));
            return response;
        } finally { connection.disconnect(); }
    }
    private void claim() {
        if (prefs.contains("order")) return;
        final String base = serverAddress.getText().toString().trim().replaceAll("/+$", "");
        try {
            java.net.URI parsed = new java.net.URI(base);
            if (!java.util.Arrays.asList("http", "https").contains(parsed.getScheme()) || parsed.getHost() == null || parsed.getUserInfo() != null ||
                parsed.getQuery() != null || parsed.getFragment() != null || !parsed.getPath().isEmpty()) throw new Exception();
        } catch (Exception e) { serverAddress.setError("Use http://IP-DO-COMPUTADOR:3002, sem caminhos ou senhas."); return; }
        String merchant = handle.getText().toString().trim();
        if (!merchant.matches("[A-Za-z0-9_-]{1,100}")) { handle.setError("InfiniteTag sem $"); return; }
        final JSONObject data = new JSONObject();
        final String code = orderCode.getText().toString().trim().toUpperCase(java.util.Locale.ROOT);
        if (!code.matches("[A-F0-9]{8}")) { orderCode.setError("Informe os 8 caracteres do código do totem."); return; }
        final String scope = base + "\n" + code + "\n" + merchant;
        String claimKey = prefs.getString("claim_key", "");
        if (!scope.equals(prefs.getString("claim_scope", "")) || !claimKey.matches("[a-f0-9]{32}")) {
            claimKey = UUID.randomUUID().toString().replace("-", "");
        }
        // Save before sending: a lost response or process restart must reuse this secret.
        if (!prefs.edit().putString("claim_scope", scope).putString("claim_key", claimKey)
            .putString("handle", merchant).putString("server", base).putString("claim_code", code).commit()) {
            status.setText("Não foi possível salvar a tentativa no celular. Nenhum pedido foi conectado. Libere espaço e tente novamente."); return;
        }
        try { data.put("code", code); data.put("handle", merchant); data.put("claimKey", claimKey); }
        catch (Exception e) { return; }
        background(() -> post(base, "/api/tap-demo/claim", data, null), response -> {
            if (response.getInt("amountCents") != 100) throw new Exception();
            prefs.edit().putString("order", response.getString("id")).putString("phone_token", response.getString("token"))
                .putString("handle", merchant).putString("server", base).putString("linked_server", base)
                .putString("order_method", response.getString("method"))
                .putString("order_label", "Estação " + response.getInt("stationId") + " · " + response.getString("vehicle") + " · R$ 1,00").apply();
            refresh();
        });
    }
    private void sendResult() {
        if (!prefs.contains("release_payload") || networking) return;
        final String base = prefs.getString("linked_server", ""), order = prefs.getString("order", ""), token = prefs.getString("phone_token", "");
        final String payload = prefs.getString("release_payload", "{}");
        background(() -> post(base, "/api/tap-demo/orders/" + order + "/result", new JSONObject(payload), token), response -> {
            String state = response.getString("state");
            String message = "released".equals(state) ? "Recarga iniciada no totem · retorno local de demonstração. Confira a estação."
                : response.optString("message", "Pagamento não confirmado ou pedido encerrado. Nenhuma nova recarga foi iniciada.");
            if ("null".equals(message)) message = "Pedido encerrado. Confira o InfinitePay; não repita o pagamento.";
            prefs.edit().remove("release_payload").putString("result", message).apply(); refresh();
        });
    }
}
