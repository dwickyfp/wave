from flask import Flask, jsonify, request

app = Flask(__name__)


@app.route("/webhook", methods=["POST"])
def webhook():
    payload = request.get_json(silent=True) or {}

    return jsonify(
        {
            "message": "Webhook received successfully",
            "received": payload,
        }
    ), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
