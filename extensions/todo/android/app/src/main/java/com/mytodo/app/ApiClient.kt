package com.mytodo.app

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * 极简 API 客户端：HttpURLConnection + org.json，零第三方依赖。
 * baseUrl/token/加密密钥 从 SharedPreferences("mytodo") 读取，token 以 ?token= 查询参数附加。
 *
 * Token 直连接口响应加密(与后端 X-MyTodo-Enc 约定):
 * - 所有请求带 X-MyTodo-Enc: 1,服务端将 JSON 响应换成 AES-256-GCM 信封
 * - 信封 {"encrypted":true,"iv":b64(12B),"payload":b64(密文||16B tag)}
 * - key = SHA-256(密钥字符串);响应无 encrypted 字段则按明文用(兼容旧服务端)
 */
object ApiClient {

    const val DEFAULT_TOKEN = "MDFhMDk0MTQtOWE0Yi03MGMzLWJiZDMtNGVkY2I5ODA5M2IzOjI1MzQwMjMwMDc5OTo3ZDljYTE3MzIyZWYxN2U2ZWVkNzY5Yjg3NTVhMmNhYWFlODkxMDhhNDg1MjUwMjkyNDQyZmU1NTM0MzQzNmRm"
    const val DEFAULT_BASE = "http://127.0.0.1:8070"
    const val DEFAULT_SECRET = "LizySecret"

    class Resp(val code: Int, val body: String) {
        val ok: Boolean get() = code in 200..299
        /** 422 等业务错误的中文 detail(容量上限提示等),无则 null */
        fun detail(): String? = try {
            val d = JSONObject(body).optString("detail")
            if (d.isNullOrEmpty() || d == "null") null else d
        } catch (e: Exception) { null }
    }

    @Volatile private var base: String = DEFAULT_BASE
    @Volatile private var token: String = DEFAULT_TOKEN
    @Volatile private var secret: String = DEFAULT_SECRET

    fun init(ctx: Context) {
        val sp = ctx.getSharedPreferences("mytodo", Context.MODE_PRIVATE)
        val u = sp.getString("server_url", "") ?: ""
        base = if (u.isBlank()) DEFAULT_BASE else u.trim().trimEnd('/')
        val t = sp.getString("token", "") ?: ""
        token = if (t.isBlank()) DEFAULT_TOKEN else t.trim()
        val s = sp.getString("secret_key", "") ?: ""
        secret = if (s.isBlank()) DEFAULT_SECRET else s.trim()
    }

    private fun fullUrl(path: String): String {
        val enc = URLEncoder.encode(token, "UTF-8")
        val sep = if (path.contains('?')) "&" else "?"
        return "$base/api/v1$path${sep}token=$enc"
    }

    fun get(path: String): Resp = http("GET", path, null)

    fun post(path: String, body: JSONObject?): Resp = http("POST", path, body)

    fun patch(path: String, body: JSONObject?): Resp = http("PATCH", path, body)

    fun delete(path: String): Resp = http("DELETE", path, null)

    /** AES-256-GCM 解密信封;非信封原样返回;解密失败抛带中文提示的异常 */
    private fun unwrap(text: String): String {
        if (text.isEmpty() || !text.trimStart().startsWith("{")) return text
        val o = try { JSONObject(text) } catch (e: Exception) { return text }
        if (!o.optBoolean("encrypted", false)) return text
        try {
            val iv = Base64.decode(o.optString("iv"), Base64.DEFAULT)
            val payload = Base64.decode(o.optString("payload"), Base64.DEFAULT)
            val key = MessageDigest.getInstance("SHA-256").digest(secret.toByteArray(Charsets.UTF_8))
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
            return String(cipher.doFinal(payload), Charsets.UTF_8)
        } catch (e: Exception) {
            throw RuntimeException("响应解密失败,请检查密钥设置是否与服务端一致")
        }
    }

    private fun http(method: String, path: String, body: JSONObject?): Resp {
        var conn: HttpURLConnection? = null
        try {
            conn = URL(fullUrl(path)).openConnection() as HttpURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 10000
            conn.requestMethod = method
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("X-MyTodo-Enc", "1")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..399) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return Resp(code, unwrap(text))
        } finally {
            conn?.disconnect()
        }
    }
}
