import express from "express";

const app = express();
app.use(express.json());

app.post("/search", async (req, res) => {
  const fakeData = [
    {
      url: "https://ejemplo.cl/depto1",
      totalPrice: 650000,
      beds: 2,
      baths: 1,
      nearMetro: true,
      score: 80
    },
    {
      url: "https://ejemplo.cl/depto2",
      totalPrice: 780000,
      beds: 2,
      baths: 2,
      nearMetro: true,
      score: 90
    }
  ];

  res.json({
    ok: true,
    count: fakeData.length,
    items: fakeData
  });
});

app.get("/", (req, res) => {
  res.send("Scraper funcionando 🚀");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
