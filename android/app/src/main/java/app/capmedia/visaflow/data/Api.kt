package app.capmedia.visaflow.data

import app.capmedia.visaflow.model.CaseBundle
import app.capmedia.visaflow.model.MineBundle
import app.capmedia.visaflow.model.ShipmentBundle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Ce que l'application sait demander au serveur. Sept appels, pas un de plus :
 * le client ne parle jamais aux tables, seulement à des fonctions qui décident
 * elles-mêmes de ce qu'elles rendent. Même contrat que ios/Sources/Data/API.swift.
 */
interface Api {
    suspend fun requestCode(agency: String, phone: String)
    suspend fun verifyCode(agency: String, phone: String, code: String): String
    suspend fun mine(agency: String, deviceToken: String): MineBundle
    suspend fun caseBundle(token: String): CaseBundle
    suspend fun shipmentBundle(token: String): ShipmentBundle
    suspend fun send(message: String, caseToken: String)
    suspend fun upload(bytes: ByteArray, fileName: String, documentKey: String, caseToken: String)
}

sealed class ApiError(message: String) : Exception(message) {
    data object Network : ApiError("reseau")
    data object BadCode : ApiError("code")
    data object Blocked : ApiError("bloque")
    data object NotFound : ApiError("introuvable")
    data class Server(val detail: String) : ApiError(detail)
}

/** Le décodeur du produit. Tolérant aux champs inconnus : le serveur peut
 *  gagner une colonne sans casser une application déjà installée. */
internal val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

/** L'implémentation qui parle à Supabase, par ses fonctions RPC. */
class LiveApi(
    private val baseUrl: String,
    private val anonKey: String,
) : Api {

    private suspend fun rpc(name: String, body: JsonObject): String = withContext(Dispatchers.IO) {
        val connection = (URL("$baseUrl/rest/v1/rpc/$name").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 20_000
            readTimeout = 20_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("apikey", anonKey)
            setRequestProperty("Authorization", "Bearer $anonKey")
        }
        try {
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = connection.responseCode
            val text = when {
                code in 200..299 -> connection.inputStream.bufferedReader().use { it.readText() }
                else -> connection.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            }
            when {
                code in 200..299 -> text
                code == 404 -> throw ApiError.NotFound
                // 429 : la limitation de débit du serveur. Un code demandé
                // quinze fois d'affilée est un robot, pas un client pressé.
                code == 429 -> throw ApiError.Blocked
                else -> throw ApiError.Server(text.ifBlank { "HTTP $code" })
            }
        } catch (e: IOException) {
            throw ApiError.Network
        } finally {
            connection.disconnect()
        }
    }

    override suspend fun requestCode(agency: String, phone: String) {
        rpc("issue_otp", buildJsonObject {
            put("p_agency_slug", JsonPrimitive(agency))
            put("p_phone", JsonPrimitive(phone))
        })
    }

    override suspend fun verifyCode(agency: String, phone: String, code: String): String {
        val text = rpc("verify_otp", buildJsonObject {
            put("p_agency_slug", JsonPrimitive(agency))
            put("p_phone", JsonPrimitive(phone))
            put("p_code", JsonPrimitive(code))
        })
        val result = json.parseToJsonElement(text).jsonObject
        val ok = result["ok"]?.jsonPrimitive?.content == "true"
        val token = result["device_token"]?.jsonPrimitive?.content
        if (!ok || token.isNullOrBlank()) throw ApiError.BadCode
        return token
    }

    override suspend fun mine(agency: String, deviceToken: String): MineBundle =
        json.decodeFromString(rpc("portal_mine", buildJsonObject {
            put("p_agency_slug", JsonPrimitive(agency))
            put("p_device_token", JsonPrimitive(deviceToken))
        }))

    override suspend fun caseBundle(token: String): CaseBundle =
        json.decodeFromString(rpc("portal_case", buildJsonObject {
            put("p_token", JsonPrimitive(token))
        }))

    override suspend fun shipmentBundle(token: String): ShipmentBundle =
        json.decodeFromString(rpc("portal_shipment", buildJsonObject {
            put("p_token", JsonPrimitive(token))
        }))

    override suspend fun send(message: String, caseToken: String) {
        rpc("portal_send", buildJsonObject {
            put("p_token", JsonPrimitive(caseToken))
            put("p_body", JsonPrimitive(message))
        })
    }

    override suspend fun upload(bytes: ByteArray, fileName: String, documentKey: String, caseToken: String) {
        // Le dépôt passe par la fonction de bord portal-upload : elle valide le
        // jeton, dépose avec la clé de service et impose le chemin. L'app ne
        // choisit jamais où la pièce atterrit.
        withContext(Dispatchers.IO) {
            val connection = (URL("$baseUrl/functions/v1/portal-upload").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 30_000
                readTimeout = 60_000
                setRequestProperty("apikey", anonKey)
                setRequestProperty("Authorization", "Bearer $anonKey")
                setRequestProperty("Content-Type", mimeOf(fileName))
                setRequestProperty("x-portal-token", caseToken)
                setRequestProperty("x-document-key", documentKey)
                setRequestProperty("x-file-name", fileName)
            }
            try {
                connection.outputStream.use { it.write(bytes) }
                if (connection.responseCode !in 200..299) throw ApiError.Server("dépôt refusé")
            } catch (e: IOException) {
                throw ApiError.Network
            } finally {
                connection.disconnect()
            }
        }
    }

    private fun mimeOf(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "png" -> "image/png"
        "heic" -> "image/heic"
        "heif" -> "image/heif"
        "pdf" -> "application/pdf"
        else -> "image/jpeg"
    }
}
