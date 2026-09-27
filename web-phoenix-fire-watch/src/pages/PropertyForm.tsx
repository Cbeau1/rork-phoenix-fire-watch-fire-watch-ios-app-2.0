import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Loader2, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { Card, CardHeader, FieldError, FieldHint, FieldLabel, PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/supabase";
import type { PropertyInput } from "@/lib/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useFireWatch } from "@/state/FireWatchProvider";

import NotFound from "./NotFound";

const schema = z.object({
  name: z.string().trim().min(1, "Property name is required").max(120),
  address: z.string().trim().min(1, "Address is required").max(240),
  contactName: z.string().trim().max(120),
  contactPhone: z.string().trim().max(40),
  contactEmail: z.union([z.literal(""), z.string().trim().email("Enter a valid email address")]),
  notes: z.string().trim().max(2000),
});

type FormValues = z.infer<typeof schema>;

const PropertyForm = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { propertyById, addProperty, updateProperty } = useFireWatch();
  const existing = id ? propertyById.get(id) : undefined;
  const isEdit = !!id;
  useDocumentTitle(isEdit ? "Edit Property" : "Add Property");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: existing?.name ?? "",
      address: existing?.address ?? "",
      contactName: existing?.contactName ?? "",
      contactPhone: existing?.contactPhone ?? "",
      contactEmail: existing?.contactEmail ?? "",
      notes: existing?.notes ?? "",
    },
  });

  if (isEdit && !existing) return <NotFound embedded />;

  const onSubmit = async (raw: FormValues) => {
    const values: PropertyInput = {
      name: raw.name ?? "",
      address: raw.address ?? "",
      contactName: raw.contactName ?? "",
      contactPhone: raw.contactPhone ?? "",
      contactEmail: raw.contactEmail ?? "",
      notes: raw.notes ?? "",
    };
    try {
      if (existing) {
        const saved = await updateProperty({ id: existing.id, input: values });
        toast.success(saved.syncState === "pending" ? "Saved offline — will sync when you reconnect" : "Property updated");
        navigate(`/properties/${existing.id}`);
      } else {
        const created = await addProperty(values);
        toast.success(created.syncState === "pending" ? "Property saved offline" : "Property created", {
          description: created.syncState === "pending" ? "It will sync to your team when you reconnect." : created.name,
        });
        navigate(`/properties/${created.id}`);
      }
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't save the property"));
    }
  };

  const backTo = existing ? `/properties/${existing.id}` : "/properties";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        backTo={backTo}
        backLabel={existing ? "Back to Property" : "Back to Properties"}
        title={existing ? "Edit Property" : "Add New Property"}
        subtitle={existing ? existing.name : "Register a new location for fire watch patrol monitoring"}
      />

      <Card>
        <CardHeader
          icon={Building2}
          title="Property Details"
          subtitle="Enter the property information and contact details"
          className="border-b border-line pb-6"
        />
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6 px-6 py-7 sm:px-7">
          <div>
            <FieldLabel htmlFor="name" required>
              Property Name
            </FieldLabel>
            <Input
              id="name"
              placeholder="e.g., Downtown Office Complex"
              aria-invalid={!!errors.name}
              {...register("name")}
            />
            <FieldError message={errors.name?.message} />
          </div>
          <div>
            <FieldLabel htmlFor="address" required>
              Address
            </FieldLabel>
            <Input
              id="address"
              placeholder="123 Main St, City, State ZIP"
              autoComplete="street-address"
              aria-invalid={!!errors.address}
              {...register("address")}
            />
            <FieldError message={errors.address?.message} />
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="contactName">Contact Name</FieldLabel>
              <Input id="contactName" placeholder="Site manager or owner" {...register("contactName")} />
            </div>
            <div>
              <FieldLabel htmlFor="contactPhone">Contact Phone</FieldLabel>
              <Input
                id="contactPhone"
                type="tel"
                inputMode="tel"
                placeholder="(555) 123-4567"
                className="font-mono"
                {...register("contactPhone")}
              />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="contactEmail">Contact Email</FieldLabel>
            <Input
              id="contactEmail"
              type="email"
              placeholder="manager@property.com"
              aria-invalid={!!errors.contactEmail}
              {...register("contactEmail")}
            />
            {errors.contactEmail ? (
              <FieldError message={errors.contactEmail.message} />
            ) : (
              <FieldHint>Used for patrol report delivery</FieldHint>
            )}
          </div>
          <div>
            <FieldLabel htmlFor="notes">Notes</FieldLabel>
            <Textarea
              id="notes"
              placeholder="Special instructions, access codes, or important details..."
              {...register("notes")}
            />
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => navigate(backTo)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : <Save />}
              {existing ? "Save Changes" : "Create Property"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default PropertyForm;
