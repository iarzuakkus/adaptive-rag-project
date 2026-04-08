# Adaptive RAG Chrome Extension

## Proje Hakkında

Adaptive RAG Chrome Extension, kullanıcının gezdiği web sayfalarından içerik toplayarak (scraping), bu içerikleri anlamlı parçalara bölüp embedding’lere dönüştüren ve yerel bir vektör veritabanında saklayan bir tarayıcı eklentisidir.

Kullanıcı bir soru sorduğunda sistem Retrieval-Augmented Generation (RAG) pipeline çalıştırır, en ilgili içerikleri bulur ve LLM’e bağlam olarak göndererek kişiselleştirilmiş cevap üretir.

Bu yapı, kullanıcının zamanla kendi bilgi tabanını oluşturmasını ve gezdiği içeriklerden maksimum verim almasını sağlar.

---

## Özellikler

### Scraping

* Web sayfasından tam içerik veya seçili alan çıkarma
* HTML temizleme
* Gürültü kaldırma (script, style vb.)
* Metni parçalara ayırma (chunking)

### Embedding

* OpenAI, Gemini veya Claude gibi modellerle embedding üretimi
* Metin parçalarının vektörlere dönüştürülmesi

### Vector Store

* IndexedDB üzerinde local veri saklama
* Embedding ve metadata yönetimi
* Semantic search desteği

### RAG Pipeline

* Retriever: ilgili içerikleri bulur
* Prompt Builder: bağlam oluşturur
* LLM entegrasyonu: cevap üretir

### Chatbot Arayüzü

* Popup panel üzerinden soru-cevap
* Genişletilebilir yapı (sidebar, floating assistant)

### Adaptive Yapı

* Kullanıcı davranışına göre bağlam optimizasyonu
* Kişisel bilgi tabanı oluşturma

---

## Proje Mimarisi

### Extension

```
extension/rag-extension
│
├── manifest.json
│
├── core/
│   ├── api.js
│   ├── background.js
│
├── scraping/
│   ├── content.js
│   ├── cleaner.js
│
├── ui/
│   ├── popup.html
│   ├── popup.js
│   ├── styles.css
│
├── utils/
│   ├── config.js
```

### Backend

```
backend/
│
├── app.py
├── requirements.txt
│
├── core/
│   ├── embeddings.py
│   ├── rag.py
│   ├── retriever.py
│   ├── vector_store.py
│
├── routes/
│   ├── ingest.py
│   ├── query.py
│   ├── pdf.py
│
├── parsers/
│   ├── pdf_parser.py
│
├── services/
│   ├── chunking_service.py
```

---

## Çalışma Mantığı

### Veri Toplama

1. Kullanıcı web sayfasını açar
2. content.js içeriği çıkarır
3. cleaner.js temizleme ve chunking yapar
4. Embedding oluşturulur
5. Veriler IndexedDB’ye kaydedilir

### Soru-Cevap Akışı

1. Kullanıcı soru sorar
2. Retriever en ilgili içerikleri bulur
3. Prompt oluşturulur
4. LLM’e gönderilir
5. Cevap kullanıcıya döner


---

## Hedef

Kullanıcının gezdiği içeriklerden öğrenen, kişisel bilgi deposu oluşturan ve gerçek zamanlı bağlam ile çalışan bir yapay zeka destekli tarayıcı asistanı geliştirmek.
