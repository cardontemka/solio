import Image from 'next/image'
import { PageHeader } from '@/components/ui'
import styles from './page.module.css'

export const metadata = {
  title: 'Бидний тухай',
  description: 'Solio — ном, пянз солилцох монгол платформ. Бидний зорилго, түүх.',
}

/**
 * The page to say who is behind this.
 *
 * Written as a scaffold on purpose: the words and the photograph are the
 * owner's to choose, and everything here is plain markup with no data behind it
 * — edit the text in place and swap the image for a file in /public.
 */
export default function AboutPage() {
  return (
    <div className="container">
      <div className={styles.shell}>
        <PageHeader
          title="Бидний тухай"
          subtitle="Solio хэн бэ, юуны төлөө ажилладаг вэ."
        />

        {/* Swap this for your own picture: drop the file into /public and
            change the src (e.g. "/about.jpg"). Width and height only set the
            aspect ratio — the CSS makes it fill the column. */}
        <figure className={styles.figure}>
          <Image
            className={styles.image}
            src="/header-logo.png"
            alt=""
            width={512}
            height={512}
            priority
          />
          <figcaption className={styles.caption}>
            Зургийн тайлбар энд орно.
          </figcaption>
        </figure>

        <div className={styles.prose}>
          <h2>Зорилго</h2>
          <p>
            Уншсан ном, сонссон пянз шүүгээнд хэвтэхийн оронд дараагийн хүн рүүгээ
            очих ёстой гэж бид боддог. Solio бол тэр гарцыг хялбар болгох оролдлого —
            хэн юу эзэмшиж байгаа, хаана байгаа, хэрхэн гар дамжсаныг нь ил тод
            харуулж, солилцоог хоёр талын баталгаатай болгосон платформ.
          </p>

          <h2>Хэрхэн ажилладаг вэ</h2>
          <p>
            Гартаа байгаа номоо бүртгэнэ. Хүссэн номоо олж, өөрийнхөө нэгийг санал
            болгоно. Биечлэн уулзаж солилцоод, QR-ыг уншуулж
            баталгаажуулна. Уулзах боломжгүй бол хадгалах цэгээр дамжуулж болно.
          </p>

          <h2>Холбоо барих</h2>
          <p>
            Санал хүсэлт, хамтын ажиллагааны талаар{' '}
            <a href="mailto:ptemuulen82@gmail.com">ptemuulen82@gmail.com</a> хаягаар
            эсвэл <a href="tel:+97695859278">95859278</a> дугаараар холбогдоно уу.
          </p>
        </div>
      </div>
    </div>
  )
}
