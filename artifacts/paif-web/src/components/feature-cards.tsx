import { DollarSign, RefreshCw, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: DollarSign,
    title: "Creator Fees",
    description: "Where they went",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
  },
  {
    icon: RefreshCw,
    title: "Buybacks",
    description: "If the creator put money back in",
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
  },
  {
    icon: ShieldCheck,
    title: "Risk Evidence",
    description: "What the chain can prove",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
];

export function FeatureCards() {
  return (
    <div className="mt-12 md:mt-20">
      <h2
        className="text-xl sm:text-2xl font-bold text-center text-foreground mb-8"
        data-testid="text-features-title"
      >
        What you'll see
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6 max-w-3xl mx-auto">
        {features.map((feature) => (
          <Card
            key={feature.title}
            className="hover-elevate"
            data-testid={`card-feature-${feature.title.toLowerCase().replace(/\s/g, "-")}`}
          >
            <CardContent className="p-5 flex flex-col items-center text-center gap-3">
              <div className={`w-12 h-12 rounded-md ${feature.bgColor} flex items-center justify-center`}>
                <feature.icon className={`w-6 h-6 ${feature.color}`} />
              </div>
              <div>
                <h3 className="font-bold text-foreground text-sm sm:text-base">
                  {feature.title}
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
