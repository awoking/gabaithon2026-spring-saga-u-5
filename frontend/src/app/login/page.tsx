"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"

export default function LoginPage() {
    const router = useRouter();
    return (
        <main className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-b from-green-500 via-orange-500 to-yellow-500 p-4">

            <Card className="w-full max-w-md bg-gray-200 border-none shadow-xl">
                <CardContent className="pt-7 pb-5 space-y-5">
                    <div className="space-y-2">
                        <Label htmlFor="username" className="text-gray-800 font-bold">UserName</Label>
                        <Input id="username" placeholder="名前を入力..." className="bg-white" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password" title="PassWord" className="text-gray-800 font-bold">PassWord</Label>
                        <Input id="password" type="password" placeholder="パスワードを入力..." className="bg-white" />
                    </div>
                </CardContent>
            </Card>

            <div className="mt-8 flex flex-col items-center gap-2">
                <Button
                    size="lg"
                    onClick={() => router.push("/start")}
                    className="bg-blue-500 hover:bg-blue-600 hover:scale-105 active:scale-100 transition-transform duration-200 text-white text-3xl px-12 py-8 rounded-2xl shadow-lg"
                >
                    誕生させる
                </Button>
            </div>

        </main>
  )
}